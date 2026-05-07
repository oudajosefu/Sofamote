# Rust by Sofamote — A Practical Guide for C#/.NET Developers

This guide walks every Rust concept used in the Sofamote server, in the order
you would naturally meet them while reading the code. Each section ties a
language feature to the **specific scenario** it solves in this codebase, then
explains the **memory layout, allocation behavior, and what the compiler is
actually doing**. Where the analogy to C# is direct, I lean on it; where the
analogy is misleading, I call that out.

> **Audience assumption.** You know `IDisposable`, `async/await`, generics,
> `Span<T>`, `unsafe`, value types vs. reference types, and how the .NET GC
> works at a high level. You do **not** need any prior Rust.

---

## Part 0 — The Mental Model Shift

Before reading a single line of Sofamote code, you have to internalize four
things that have no direct C# analogue. Everything else flows from these.

### 0.1 No GC. No tracing. No finalizers.

C# has a tracing GC: every reference type is boxed on the managed heap, and
the runtime periodically walks the object graph to free unreachable objects.
Rust has **none of this**. The compiler proves at compile time exactly when
each value goes out of scope, and inserts the `drop` (destructor) call there.
This is closer to C++ RAII than to .NET — but with a twist: the rules that
*let* the compiler do this proof are called **ownership** and **borrowing**.

The practical effect:

- A Rust binary has no GC pause and no runtime allocator pressure beyond what
  the program explicitly causes.
- "When does this get freed?" always has a *static* answer. You can read it
  off the source.
- There is **no** equivalent of `using`/`IDisposable` because **every** value
  is automatically dropped at end of scope. `Drop` is just the trait that
  customizes what "dropped" means (close socket, free heap, unregister Win32
  callback, etc.).

You will see this in `power.rs`:

```rust
impl Drop for ResumeRegistration {
    fn drop(&mut self) {
        unsafe { UnregisterSuspendResumeNotification(self.handle); }
    }
}
```

That `Drop` impl is *guaranteed* to run when `_resume_registration` (held in
`main`) goes out of scope — no GC needed, no `try/finally`, no `using`. The
compiler emits the call.

### 0.2 Stack vs heap is explicit, not implicit.

In C#, `class` ⇒ heap, `struct` ⇒ stack (mostly). In Rust, **every** type is
stack-by-default. If you want heap allocation, you say so:

| C# pattern                | Rust equivalent                          | Where it lives |
|---------------------------|------------------------------------------|---------------|
| `new Foo()` (class)       | `Foo { ... }`                            | Stack         |
| —                         | `Box::new(Foo { ... })`                  | Heap, owned   |
| `string` (immutable, GC)  | `String` (growable) / `&str` (borrowed)  | Heap / view   |
| `List<T>`                 | `Vec<T>`                                 | Heap          |
| `T[]`                     | `[T; N]` (fixed) / `Vec<T>` / `&[T]`     | Stack/heap/view |
| `Dictionary<K,V>`         | `HashMap<K, V>`                          | Heap          |
| Reference type field      | `Box<T>` if you want indirection         | Heap          |

This is the single biggest cognitive shift. When you see `let cfg: Config =
load_or_create();` in `main.rs`, that struct lives **on the stack frame of
`main`**. The same struct moved into `Arc::new(Self { ... })` in
`state.rs:27` is now in a heap allocation behind a reference-counted pointer.

### 0.3 One owner. Many borrowers. Or many owners with explicit sharing.

The single rule that drives Rust:

> Every value has exactly one **owner**. When the owner goes out of scope, the
> value is dropped. You can hand out **references** (borrows), but at any
> moment a value either has **one mutable reference** or **any number of
> shared (immutable) references** — never both.

Compare to C# where every reference-type variable is essentially a mutable
shared pointer with no compile-time enforcement. In Rust, sharing across
owners requires an explicit type:

- `Arc<T>` — atomically reference-counted, cross-thread (think
  `Interlocked`-incrementing refcount).
- `Rc<T>` — single-threaded refcounted. Not used in Sofamote.
- `Arc<RwLock<T>>` / `Arc<Mutex<T>>` — refcounted access plus runtime mutex.

You will see `Arc<AppState>` and `Arc<RwLock<String>>` everywhere in
Sofamote because the server has multiple tasks (and the tray thread) reading
and mutating shared state.

### 0.4 Errors and absence are values, not control flow.

C# uses `null` for "absent" and exceptions for "failed". Rust uses two
enums in the standard library:

```rust
enum Option<T> { Some(T), None }
enum Result<T, E> { Ok(T), Err(E) }
```

There is no null. There is no thrown exception in normal Rust code — only
panics, which abort the thread (the rough analogue of an unrecoverable
`StackOverflowException`, not a regular `InvalidOperationException`).

Both enums are used **constantly** in Sofamote. The `?` operator (which
you'll see in `keystrokes.rs`, `http.rs`, etc.) is sugar for "if `Err`,
return the error; otherwise unwrap the `Ok`". It's a less verbose version of:

```csharp
var result = TryFoo();
if (!result.Success) return result.Error;
var value = result.Value;
```

That's it. With those four ideas held in your head, the rest of this guide
is just naming the spelling of each concept and seeing it in Sofamote.

---

## Part 1 — Project Layout: Cargo, Crates, Modules

### 1.1 `Cargo.toml` — the project manifest

`server/Cargo.toml` is roughly the equivalent of a `.csproj` plus
`packages.lock.json`. Highlights:

```toml
[package]
name = "sofamote"
version = "0.8.0"
edition = "2021"

[[bin]]
name = "sofamote"
path = "src/main.rs"

[dependencies]
tokio = { version = "1", features = ["full"] }
axum  = { version = "0.7", features = ["ws"] }
serde = { version = "1", features = ["derive"] }
...

[target.'cfg(windows)'.dependencies]
winreg = "0.52"
windows-sys = { version = "0.52", features = [
    "Win32_Foundation",
    "Win32_System_Power",
    "Win32_UI_WindowsAndMessaging",
] }

[build-dependencies]
png = "0.17"
```

What's worth knowing:

- **`edition = "2021"`** — Rust has "editions" instead of language version
  bumps. Each edition can change defaults and syntax (e.g. how closures
  capture, how `?` interacts with traits) without breaking older crates,
  because the edition is stored per-crate and the compiler keeps both
  parsers/desugarings around.
- **Features** — `tokio = { features = ["full"] }` is a conditional
  compilation toggle. The `tokio` crate is *one* crate, but you can opt in
  or out of subsystems. The compiler only compiles what you ask for. Think
  of it as a much more granular `<PackageReference Condition="...">`.
- **`[[bin]]`** — declares a binary target. A crate (a Rust compilation unit)
  can also be a `[lib]` or have multiple `[[bin]]`s. Sofamote has one.
- **`[target.'cfg(windows)'.dependencies]`** — platform-conditional deps.
  `winreg` and `windows-sys` are only pulled in when compiling for Windows.
  This is what `#[cfg(target_os = "windows")]` resolves against in source.
- **`[build-dependencies]`** — separate dep set for `build.rs`, which runs
  *before* the main compile.

### 1.2 Modules: `mod foo;` is not `using foo;`

The top of `main.rs` looks like this:

```rust
mod autolaunch;
mod config;
mod http;
mod keystrokes;
mod net;
mod power;
mod profiles;
mod single_instance;
mod state;
mod tray;
mod types;
mod ws;
```

This is **not** "import these namespaces". This is "the file system contains
a module tree rooted here; declare which sibling files are part of this
crate". Each `mod foo;` says "there is a file `src/foo.rs` (or
`src/foo/mod.rs`) and it is a child of this module".

Compare to C#:
- C# discovers all `.cs` files under the project automatically, and
  namespaces are advisory.
- Rust requires you to explicitly graft each file onto the module tree, and
  the module tree is **enforced as a privacy boundary**. Items are private
  by default; `pub` makes them visible to the parent.

To use an item from another module you write `use crate::types::Command;` —
that's the closest equivalent to C#'s `using` directive. The `crate::` prefix
means "from the root of this crate". You'll see this idiom on every file:

```rust
// ws.rs
use crate::keystrokes;
use crate::profiles;
use crate::state::{AppState, StateEvent};
use crate::types::{Command, ServerMessage, ALL_PROFILES, VERSION};
```

Each `use` line is a name binding, similar to a C# `using static` plus
`using alias`. They cost nothing at runtime.

### 1.3 The crate-level attribute in `main.rs`

```rust
#![cfg_attr(
    all(target_os = "windows", not(debug_assertions)),
    windows_subsystem = "windows"
)]
```

`#![...]` is a **crate-level** attribute (the `!` makes it apply to the
enclosing item, which here is the whole crate). `cfg_attr(cond, attr)` says
"if `cond` holds at compile time, apply `attr`". So this expands to:

> On Windows release builds (debug_assertions off), set
> `#![windows_subsystem = "windows"]`.

That, in turn, tells the linker to mark the EXE as a GUI subsystem binary so
Windows doesn't pop up a console window when the user runs it from File
Explorer. On any other config (debug build, Linux, macOS), the attribute
isn't applied, and you get a normal console.

This is a tiny example of one of Rust's superpowers: **conditional
compilation is first-class and runs at the parser level**, so platform
differences are expressed in-source instead of via build configurations.

---

## Part 2 — Types, Enums, Derive Macros (`types.rs`)

`types.rs` is the wire-format module: every JSON message exchanged with the
phone has a Rust type here. It's a great first stop because it shows off
enums, derive macros, and serde — three things you'll meet on every page.

### 2.1 C-like enums

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum KeyName {
    Space, Left, Right, Up, Down, Enter, Escape,
    F, M, C, J, K, L, N, Comma, Period, Tab,
    Backspace, Delete, Home, End, PageUp, PageDown,
    A, D, R, T, V, W, X, Z, F12,
}
```

This looks like a C# `enum`. **It is not.** Rust enums are *tagged unions*
(also called sum types or discriminated unions — closer to F#'s
`type Foo = A | B of int` than to C# `enum`). When every variant carries no
data (as here), the layout collapses to a small integer discriminant, and
this *is* essentially a C-style enum. The compiler will use `u8` here
because there are fewer than 256 variants.

**Memory layout.** A `KeyName` value is one byte on the stack. Copying it is
a `mov`. There is no heap allocation, no boxing, no virtual dispatch.

### 2.2 `derive` — automatic trait implementations

The `#[derive(...)]` attribute is **the** workhorse of ergonomic Rust.
Each name inside is a *trait*; `derive` asks the compiler to generate a
default implementation by walking the type's structure.

| Trait          | What the derived impl gives you                                                        | Closest C# equivalent |
|----------------|----------------------------------------------------------------------------------------|----------------------|
| `Debug`        | `format!("{:?}", x)` produces a developer-readable string.                             | `ToString()`/debugger |
| `Clone`        | `.clone()` produces an independent copy.                                               | `ICloneable.Clone()` |
| `Copy`         | Marker: "copying me is just `memcpy`; don't `move` me."                                 | `struct` value semantics |
| `PartialEq`/`Eq` | `==`, `!=` operators.                                                                | `IEquatable<T>`      |
| `Hash`         | Usable as a hashmap key.                                                              | `GetHashCode()`      |
| `Deserialize`  | Can be parsed from JSON/etc. (provided by `serde` crate).                              | `JsonSerializer.Deserialize` |
| `Serialize`    | Can be written as JSON/etc.                                                            | `JsonSerializer.Serialize` |

The `#[serde(rename_all = "camelCase")]` attribute tells the derived
`Serialize`/`Deserialize` to map `PlayPause` ⇄ `"playPause"`. So a JSON
string `"playPause"` parses straight into `ActionName::PlayPause` with no
manual mapping.

**Why both `Clone` and `Copy`?** This is one of Rust's subtle mechanics.
`Copy` is a marker trait that tells the compiler "for this type, `=` and
function-argument passing should *implicitly duplicate* the bits, the same
way primitives do". `Clone` is the explicit operation (`.clone()`). All
`Copy` types must also be `Clone`. The C# analogue is the `struct` keyword
implicitly enabling value-copy semantics — except in C#, *all* structs are
copy-on-assignment, while in Rust copy semantics are opt-in via `Copy`.

`KeyName` is `Copy` because it's a one-byte enum with no resources. Compare
to `String`, which is `Clone` but **not** `Copy`: cloning a `String` heap-
allocates a fresh buffer; the compiler refuses to do that implicitly.

### 2.3 Tagged enums with payloads — the `Command` type

```rust
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Command {
    Key { key: KeyName, #[serde(default)] mods: Vec<Modifier> },
    Combo { keys: Vec<KeyName> },
    Action { name: ActionName, profile: Option<ProfileName> },
    MouseMove { dx: f32, dy: f32 },
    MouseClick { button: MouseButton },
    MouseButton { button: MouseButton, action: MouseAction },
    MouseScroll { dx: f32, dy: f32 },
    TypeText { text: String },
}
```

This is a **discriminated union with payloads**. The C# 13 closest analog is
record hierarchies + pattern matching, but Rust gets it baked in.

Memory layout:
- The compiler computes the size needed for each variant's payload.
- The enum's overall size = `max(variant_sizes) + tag_size`, with alignment.
- A discriminant tag (typically a `u8`) selects which variant is active.
- Pattern matching against a variant is a single compare-and-jump.

So a `Command::MouseMove { dx: 1.0, dy: 2.0 }` lives entirely on the stack
as a tag plus 8 bytes. A `Command::TypeText { text: String }` carries a
`String` payload, which is itself 24 bytes on the stack (a pointer, length,
capacity triple) pointing at heap-allocated UTF-8 bytes.

The `#[serde(tag = "type", rename_all = "camelCase")]` attribute tells
serde to use a JSON shape like:

```json
{ "type": "mouseMove", "dx": 1.0, "dy": 2.0 }
```

instead of the default `{ "MouseMove": { "dx": 1.0, "dy": 2.0 } }`. This is
called *internally tagged* representation, and it's why the protocol on the
wire is so clean.

### 2.4 `Option<T>` — there is no null

```rust
Action { name: ActionName, profile: Option<ProfileName> }
```

`Option<T>` is the Rust equivalent of C#'s `T?`. It's an enum:

```rust
enum Option<T> { Some(T), None }
```

For most types, the compiler does the **niche optimization**: it picks an
unused bit pattern of `T` to mean `None`, so `Option<T>` has the same size
as `T`. For example, `Option<&u8>` is one pointer, with `None` represented
as a null pointer — the compiler is allowed to do this because the language
guarantees `&T` is never null in safe Rust.

Pattern matching is the only way to extract the value:

```rust
match cmd {
    Command::Action { name, profile } => {
        let recipe = profiles::resolve_action(profile, name)
            .ok_or_else(|| format!("no mapping for action {name:?} in profile {profile:?}"))?;
        ...
    }
    ...
}
```

You'll often see `.unwrap()`, `.expect("...")`, `.ok_or_else(...)`,
`.map(...)`, `.and_then(...)`, `?`, `if let Some(x) = ...`. All of these
are tools for unpacking `Option`/`Result`.

### 2.5 Borrowed vs. owned strings: the `'a` lifetime in `ServerMessage`

```rust
#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ServerMessage<'a> {
    Hello {
        version: &'a str,
        profiles: &'a [ProfileName],
        bindings: &'a ActionBindings,
    },
    State { active: bool },
    Ack { #[serde(skip_serializing_if = "Option::is_none")] suppressed: Option<bool> },
    Error { message: String },
}
```

`<'a>` is a **lifetime parameter**. It's a generic parameter, but instead of
being a *type*, it's a *region of code* during which a borrow is valid.
Read it as: "this enum borrows some data, and that data must outlive `'a`".

Why use it? Compare these two fields:

- `version: &'a str` — a borrowed string slice. Just two machine words on
  the stack: a pointer and a length pointing into someone else's buffer.
  The compiler will refuse to let the `ServerMessage` outlive that buffer.
- `message: String` — an owned heap-allocated UTF-8 string. Three words on
  the stack: pointer, length, capacity. When the `ServerMessage` drops, the
  heap buffer is freed.

Why the asymmetry? Look at how each is constructed in `ws.rs`:

```rust
let hello = ServerMessage::Hello {
    version: VERSION,                  // &'static str, lives forever
    profiles: ALL_PROFILES,            // &'static [ProfileName]
    bindings: &bindings,               // borrow of a local HashMap
};
```

vs.

```rust
ServerMessage::Error { message: format!("invalid command: {e}") }
```

The `Error` variant carries a freshly built string that has nowhere to be
borrowed *from* — so it must own. The `Hello` variant points at constants
and a local variable, so borrowing is free (no allocation, no copy). The
lifetime `'a` is what the compiler needs to prove the borrow is sound.

**The C# parallel.** There isn't one in idiomatic C#. The closest is
`ReadOnlySpan<T>` and `ReadOnlySpan<char>`, which carry the same "borrow
of someone else's memory, can't escape" semantics. But where C# enforces
that with a special compiler-blessed `ref struct` rule, Rust enforces it
generically with lifetimes, for **any** type.

### 2.6 `&'static`, `&[T]`, and constants

```rust
pub const ALL_PROFILES: &[ProfileName] = &[
    ProfileName::Auto,
    ProfileName::Generic,
    ProfileName::Youtube,
    ProfileName::Netflix,
];
pub const VERSION: &str = "0.8.0";
```

`&[T]` is a **slice**: a pointer + length pair pointing at a contiguous
sequence of `T`. It is the Rust equivalent of `ReadOnlySpan<T>`.

`&'static T` means "a reference that is valid for the entire program's
lifetime". String literals (`"0.8.0"`) and `const`-ed array literals are
embedded in the binary's `.rodata` section, so they are `&'static` by
construction. There is no allocation; the address is baked into the EXE.

This is why we can have:

```rust
pub fn resolve_action(...) -> Option<&'static ActionRecipe> { ... }
```

We hand out borrows that the caller can keep forever — because the
referent (a `LazyLock<ActionMap>`) lives in a `static`, which itself lives
forever.

---

## Part 3 — Functions, Errors, and the `?` Operator (`config.rs`)

`config.rs` is short and shows the canonical Rust I/O patterns.

### 3.1 Free functions and modules

```rust
pub fn config_path() -> PathBuf { ... }
pub fn load_or_create() -> PersistedConfig { ... }
pub fn save(cfg: &PersistedConfig) { ... }
fn generate_token() -> String { ... }
```

There are no classes. `config.rs` exposes module-level functions; the
module *is* the unit of organization. `pub` exposes an item; without `pub`
it is module-private. This maps to C# top-level static methods on a class
named `Config`, except Rust ditches the synthetic class.

### 3.2 `PathBuf` vs `&Path` — the owned-vs-borrowed pattern

```rust
pub fn config_path() -> PathBuf {
    dirs::config_dir()
        .expect("cannot determine config directory")
        .join("sofamote")
        .join("config.json")
}
```

`PathBuf` is to `&Path` as `String` is to `&str`. `PathBuf` owns a heap
buffer; `&Path` is a slice view. We return `PathBuf` here because we built
the path by joining segments — the result must own its memory.

This **owned-vs-borrowed pair** pattern repeats across the standard
library: `String/&str`, `Vec<T>/&[T]`, `PathBuf/&Path`, `OsString/&OsStr`,
`CString/&CStr`. Always check which one a function takes/returns:

- Takes `&Path` ⇒ "I just want to read the path; you keep ownership."
- Takes `PathBuf` ⇒ "I'll consume it. You can't use it after this."
- Returns `PathBuf` ⇒ "I'm constructing a new one; you own it now."

### 3.3 Method chains and `Option`/`Result` combinators

```rust
pub fn load_or_create() -> PersistedConfig {
    let path = config_path();
    if path.exists() {
        if let Ok(s) = std::fs::read_to_string(&path) {
            if let Ok(cfg) = serde_json::from_str::<PersistedConfig>(&s) {
                if cfg.token.len() >= 32 {
                    return cfg;
                }
            }
        }
    }
    let cfg = PersistedConfig {
        token: generate_token(),
        is_active: false,
        auto_launch: false,
        has_shown_pairing_qr: false,
    };
    save(&cfg);
    cfg
}
```

Several idioms in this short function:

- `if let Ok(s) = expr { ... }` — pattern match in a condition. Equivalent
  to a `match expr { Ok(s) => { ... } Err(_) => () }`. The `Err` arm is
  silently dropped.
- `serde_json::from_str::<PersistedConfig>(&s)` — calling a generic
  function with explicit type argument (the so-called "turbofish" syntax
  `::<>`). The compiler usually infers it; here we disambiguate so serde
  knows what to deserialize into.
- `&s` — a *borrow* of the `String s`, automatically converted to `&str`
  by the compiler's deref coercion. We don't move `s`; the function only
  reads it.
- `&path` — same idea; `&PathBuf` ⇒ `&Path`.

The function returns `PersistedConfig` by value. In C#, that would
allocate-and-box a `class`, or copy a `struct`. In Rust, the return moves
the value out. There is no copy of the heap data — only the stack-resident
struct (containing `String` headers, etc.) is `memcpy`'d, and ownership of
the heap buffers transfers along with it. The compiler will frequently
*also* elide that `memcpy` via NRVO-style return-value optimization.

### 3.4 `#[serde(default = "fn_name")]`

```rust
#[derive(Serialize, Deserialize, Clone)]
pub struct PersistedConfig {
    pub token: String,
    #[serde(default)]
    pub is_active: bool,
    #[serde(default)]
    pub auto_launch: bool,
    #[serde(default = "default_has_shown_pairing_qr")]
    pub has_shown_pairing_qr: bool,
}

fn default_has_shown_pairing_qr() -> bool { true }
```

`#[serde(default)]` says "if this field is missing in JSON, use
`Default::default()`" — for `bool` that's `false`. The named-function form
calls a specific function for the default. This solves a real migration
problem: when `has_shown_pairing_qr` was added in a later version,
existing configs on disk don't have it. We want existing users to behave
as if they *had* shown the QR (so we don't pop it open for them again),
hence the default `true`. New installs (where the file doesn't exist at
all) get `false` from the explicit struct literal in `load_or_create`.

This is a great example of how Rust's macro/derive system makes this kind
of forward-compat plumbing trivial — no migration code, no nullable field,
no manual JSON inspection.

### 3.5 Why the AI used this scenario

You'll often see Rust code that returns a `Result<T, io::Error>` or similar
from every fallible operation. Here, `load_or_create` is **infallible** by
design — it falls back to a freshly generated config — so it returns
`PersistedConfig` directly. The reasoning: a config-load failure on app
startup should never crash the user; degrading to a fresh token is the
right product behavior.

This is a Rust-idiomatic version of "make the bad path part of the type
system". You don't need a try/catch around `load_or_create`, because there
is no failure mode to catch.

---

## Part 4 — Ownership, Borrowing, Smart Pointers (`state.rs`)

`state.rs` is the cleanest demonstration in the codebase of Rust's
concurrency primitives. Let's go line by line.

### 4.1 The `AppState` shape

```rust
struct Inner {
    token: String,
    is_active: bool,
    auto_launch: bool,
    has_shown_pairing_qr: bool,
}

pub struct AppState {
    inner: RwLock<Inner>,
    pub tx: broadcast::Sender<StateEvent>,
}
```

This is the canonical "shared mutable state" pattern. Two layers:

1. `RwLock<Inner>` — the mutex. Compile-time enforced: you cannot touch
   `inner`'s fields without first acquiring the lock.
2. `Arc<AppState>` — the reference-counted pointer that lets multiple
   tasks/threads hold the same state.

Note that `pub tx: broadcast::Sender<StateEvent>` is exposed without a
lock. `broadcast::Sender` is internally synchronized (it's its own concurrent
data structure), so it doesn't need an outer lock.

### 4.2 `Arc<T>` — atomic refcounting

```rust
pub fn new(cfg: PersistedConfig) -> Arc<Self> {
    let (tx, _) = broadcast::channel(16);
    Arc::new(Self {
        inner: RwLock::new(Inner { ... }),
        tx,
    })
}
```

`Arc::new(value)` does two things:
1. Heap-allocates a control block containing two atomic counters (strong,
   weak) and the `value`.
2. Returns an `Arc<T>` — a single-word smart pointer to that block.

When you `Arc::clone(&arc)`, you get a new `Arc<T>` pointing at the same
block, with the strong count atomically incremented. When the last
`Arc<T>` drops, the block is freed.

C# analogue: there isn't one. `class` references in C# are GC-traced; you
don't see refcount increments because the GC handles graph traversal
later. `Arc<T>` is closer to `std::shared_ptr<T>` in C++ — except in Rust
you cannot cycle it without `Weak<T>`, because there's no cycle collector.

You'll see `Arc::clone(&app_state)` everywhere in `main.rs`:

```rust
let state_bg = Arc::clone(&app_state);
let pairing_url_bg = Arc::clone(&pairing_url);
let token_bg = token.clone();
let server_thread = std::thread::spawn(move || { ... });
```

Each `Arc::clone` is a pointer copy + atomic increment. Cheap, but not
free. The reason we explicitly clone before `move`-ing into the thread:

> The closure `move || { ... }` consumes (moves) every variable it
> captures. If we move the original `app_state` into the thread, the main
> function can't use it anymore. We want both, so we clone first.

This is the most common pattern of all in async Rust.

### 4.3 `tokio::sync::RwLock` vs `std::sync::RwLock`

There are *two* `RwLock`s in this codebase, and the difference matters.

| Type                       | Locking is...        | Used in        |
|---------------------------|----------------------|----------------|
| `std::sync::RwLock<T>`    | blocking (parks OS thread) | `pairing_url` (read from sync tray loop and async server) |
| `tokio::sync::RwLock<T>`  | awaitable (yields the task) | `AppState.inner` (only ever held in async context) |

When you `await` an async lock, the task is suspended and another task can
run on the same OS thread. When you call `.read()`/`.write()` on a sync
lock, the OS thread blocks. **Mixing them wrong is a footgun**: holding a
sync lock across an `.await` can deadlock the executor.

Sofamote uses each correctly:
- `pairing_url: Arc<RwLock<String>>` (std) — accessed from the tray
  thread (sync) and the async tasks. The async accesses are short and
  non-blocking, so std is fine.
- `inner: RwLock<Inner>` (tokio) — only touched from `async fn`s.

### 4.4 `async fn`, `.await`, and what they actually compile to

```rust
pub async fn token(&self) -> String {
    self.inner.read().await.token.clone()
}
```

Read this as: "acquire a read lock (suspending if needed), then clone the
token string out of the inner struct".

What the compiler does:
- Rewrites the function body into a state machine implementing the
  `Future` trait. Each `.await` becomes a state transition.
- The function no longer "runs" eagerly when called — it returns an
  *opaque* `impl Future<Output = String>` that you must `.await` to drive.
- The state of all locals at each `.await` point is preserved in a
  compiler-generated struct. That struct lives **wherever the future
  lives** — usually on the heap via `Box<dyn Future>` or directly inside
  an executor's task slab.

This is materially different from C# `async`. In C#, `async` methods
return `Task<T>` objects allocated on the GC heap; the state machine is
also boxed. In Rust, the state machine is a stack-sized struct by default,
and the compiler *only* heap-allocates if you explicitly `Box::pin` it or
spawn it on a runtime.

This is what makes Rust async **zero-cost** in principle: an `async fn`
that never `.await`s anything compiles to roughly the same code as a sync
fn, with no allocation.

### 4.5 The `set_active` write path — locks, drops, broadcasts

```rust
pub async fn set_active(&self, next: bool) {
    let mut inner = self.inner.write().await;
    if inner.is_active == next {
        return;
    }
    inner.is_active = next;
    let cfg = PersistedConfig {
        token: inner.token.clone(),
        is_active: inner.is_active,
        auto_launch: inner.auto_launch,
        has_shown_pairing_qr: inner.has_shown_pairing_qr,
    };
    drop(inner);                  // explicit lock release
    config::save(&cfg);           // file I/O happens unlocked
    self.tx.send(StateEvent::ActiveChanged(next)).ok();
}
```

Several pieces here:

1. **`let mut inner = self.inner.write().await;`** — acquires a write
   guard. The guard implements `Drop`; releasing the lock is just letting
   the guard go out of scope.
2. **`drop(inner);`** — explicit early drop. We don't want to hold the
   write lock while doing file I/O (could block other tasks). `drop()` is
   a function in the prelude that takes ownership and lets the value fall
   out of scope immediately.
3. **`.ok()`** on the broadcast send — `tx.send` returns
   `Result<usize, SendError>` (number of receivers, or error if no
   receivers). We don't care here; `.ok()` discards the success value and
   converts to `Option<()>`, which we then ignore. Rust *forces* you to
   acknowledge unused `Result`s; this is the idiomatic acknowledgement.

This pattern — acquire lock, copy out what you need, release, then do I/O
or other slow work — is the bread and butter of writing concurrent Rust.

### 4.6 `blocking_write` — the tray thread cheat

```rust
pub fn mark_pairing_qr_shown(&self) {
    let mut inner = self.inner.blocking_write();
    ...
}
```

This is **not** `async`, it's `fn`. The tray code runs on the main thread
(not inside the tokio runtime). To touch the tokio `RwLock` from there, we
use `blocking_write`, which OS-blocks until acquisition. Tokio's locks
support both async and blocking acquisition, which is rare and pragmatic.

The AI's reasoning here: "I need to mutate state from a sync (non-tokio)
context once per startup; spinning up a runtime handle is overkill;
`blocking_write` is the right escape hatch."

### 4.7 `broadcast::channel` — multi-producer, multi-consumer

```rust
let (tx, _) = broadcast::channel(16);
```

A broadcast channel is the Rust equivalent of `IObservable<T>`/an event:
**every** subscriber gets every message (subject to backpressure). The
buffer size (16) is the per-subscriber lag tolerance — if a subscriber
falls behind, it gets a `Lagged` error and the oldest messages are
dropped.

The unused `_` here is the initial receiver — we throw it away because
new receivers are minted via `state.subscribe()`:

```rust
pub fn subscribe(&self) -> broadcast::Receiver<StateEvent> {
    self.tx.subscribe()
}
```

Look at how the tray loop in `main.rs` consumes events:

```rust
let mut state_rx = app_state.subscribe();
...
while let Ok(event) = state_rx.try_recv() {
    match event {
        StateEvent::ActiveChanged(v) => { active = v; tray_handle.set_active(active); }
        StateEvent::PairingUrlRefreshed => { tray_handle.refresh_pairing_url(); }
    }
}
```

`try_recv` is non-blocking; the tray loop polls each tick. Inside an
async task, you'd `.recv().await` instead. Same channel, different
acquisition style. This polymorphism is one reason tokio's primitives
appear in non-async code throughout this server.

---

## Part 5 — Traits, Generics, Web Handlers (`http.rs`)

This file is the most type-heavy in the project, and a great vehicle for
explaining traits, generics, and "axum-style" extractor magic.

### 5.1 Traits as interfaces — but more

```rust
impl FromRef<RouterState> for Arc<AppState> {
    fn from_ref(s: &RouterState) -> Self {
        s.app.clone()
    }
}
```

A *trait* is an interface. `FromRef<RouterState>` is a trait defined by
axum that says "given a `&RouterState`, you can extract me". The compiler
sees this `impl` and now knows that anywhere axum needs an
`Arc<AppState>`, it can derive one from a `RouterState`.

Differences from C# interfaces:
- You can `impl` a trait for a type **outside** that type's defining
  module, as long as either the type or the trait is local to your
  crate (the "orphan rule"). C# requires the type to declare its
  interfaces inline, with a few extension exceptions.
- Traits can have generic parameters and associated types and constants
  and default method implementations. They are *strictly* more
  expressive than C# interfaces.
- A trait method call via a generic parameter `T: FromRef<...>` is
  **statically dispatched** — the compiler monomorphizes a copy of the
  caller per concrete `T` (zero-cost). Through `dyn Trait`, dispatch is
  **virtual** through a vtable. You opt in to vtables explicitly; nothing
  is virtual by default.

### 5.2 The `RustEmbed` derive — embedding files in the EXE

```rust
#[derive(RustEmbed)]
#[folder = "$CARGO_MANIFEST_DIR/../client/dist"]
struct ClientAssets;
```

This is a **proc macro**. At compile time, the `RustEmbed` derive walks
the folder, reads every file, and generates a `ClientAssets` `impl` with
a `get(path)` method that returns the bytes — embedded directly in the
binary's `.rodata` section.

The end result:
- `ClientAssets::get("index.html")` returns `Option<EmbeddedFile>` from
  baked-in bytes; no filesystem access, no I/O.
- The PWA ships *inside* the server EXE.
- When you change a file in `client/dist`, `cargo build` regenerates the
  derived code.

C# has nothing like this in the standard tooling. You'd reach for an
embedded resource via `EmbeddedResourceAttribute` plus
`Assembly.GetManifestResourceStream` — possible, but verbose. Rust's
proc-macro system makes such tools first-class.

### 5.3 The router: builder pattern with closures

```rust
pub fn build_router(app: Arc<AppState>, pairing_url: Arc<RwLock<String>>) -> Router {
    let state = RouterState { app };

    Router::new()
        .route("/", get(ws_handler))
        .route(INSTANCE_PROBE_PATH, get(instance_probe_handler))
        .route(
            "/qr.png",
            get(move |s| qr_handler(s, Arc::clone(&pairing_url))),
        )
        .fallback(static_handler)
        .with_state(state)
}
```

What's happening:

1. `Router::new()` returns a builder.
2. `.route(path, get(handler))` registers a GET handler. `get(...)` is a
   helper that wraps a function in axum's method-router.
3. The closure `move |s| qr_handler(s, Arc::clone(&pairing_url))` is a
   **closure that captures `pairing_url` by move**. The `move` keyword
   forces the closure to *own* its captures rather than borrow them.
   Because the closure must outlive the function that built it (the
   router stores it), it cannot borrow locals; it must own.
4. `.with_state(state)` injects the `RouterState` into the framework's
   extractor system. Handlers can request `State<RouterState>` (or any
   type that implements `FromRef<RouterState>`) as a parameter and axum
   will materialize it.

**Closure types in Rust.** Each closure has a unique anonymous compiler-
generated type. Three trait flavors describe how a closure can be called:

- `FnOnce` — can be called at most once (consumes captures).
- `FnMut` — can be called multiple times, may mutate captures.
- `Fn` — can be called multiple times, only borrows captures shared.

axum requires handlers to be `Fn` (called for every request) plus `Send +
Sync + 'static`. The closure here is `Fn` because `Arc::clone` only takes
a shared reference — no mutation, no consumption.

The state-injection mechanism is clever: axum reads the type signature of
each handler at compile time, and for each parameter calls the right
extractor (`Path`, `Query`, `State`, `Json`, etc.). This compiles down to
direct calls — no reflection, no runtime DI container.

### 5.4 Returning `impl IntoResponse` and `Response`

```rust
async fn static_handler(uri: Uri) -> Response { ... }
async fn qr_handler(...) -> impl IntoResponse { ... }
```

`impl IntoResponse` is a return-type position `impl Trait`: "I'm
returning *some* type that implements `IntoResponse`; I'm not telling you
which one". This is "existential `impl Trait`", and it's what lets us
return a tuple `(StatusCode, HeaderMap, Vec<u8>)` here, a `Response`
there, a string somewhere else — all without naming a common type.

The compiler picks one concrete type per call site. There's no boxing,
no virtual dispatch — the size is fixed at compile time per function.

C# parallel: the closest is `dynamic` or returning `object`, but those
are runtime-typed. Rust's `impl Trait` is purely compile-time.

### 5.5 The instance-probe handler — composing tuples into responses

```rust
fn instance_probe_response() -> Response {
    let mut headers = HeaderMap::new();
    headers.insert(INSTANCE_HEADER_NAME, INSTANCE_HEADER_VALUE.parse().unwrap());
    headers.insert(INSTANCE_VERSION_HEADER_NAME, VERSION.parse().unwrap());
    (StatusCode::NO_CONTENT, headers).into_response()
}
```

The tuple `(StatusCode::NO_CONTENT, headers)` has an
`IntoResponse` implementation — axum defines `IntoResponse` for tuples up
to some arity, where the first element is the status, intermediate ones
are headers, and the last is the body.

This is the moral equivalent of overloads in C#, but generalized to
arbitrary tuple structures. It's purely compile-time: the compiler sees
your tuple type and looks up the matching `IntoResponse` impl.

`.parse().unwrap()` is a common idiom: parse a `&str` into the target
type and panic if it fails. We use it here because the values are static
strings we control; if they don't parse, the program is broken and
crashing is correct.

### 5.6 `Box<dyn std::error::Error>` — type-erased errors

```rust
fn generate_qr_png(url: &str) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let code = QrCode::new(url.as_bytes())?;
    let img: GrayImage = code.render::<image::Luma<u8>>()
        .min_dimensions(512, 512)
        .quiet_zone(true)
        .build();
    let dynamic = image::DynamicImage::ImageLuma8(img);
    let mut buf = Vec::new();
    dynamic.write_to(&mut Cursor::new(&mut buf), image::ImageFormat::Png)?;
    Ok(buf)
}
```

`Box<dyn Error>` is the Rust answer to "I want to return any kind of
error". Mechanics:

- `dyn Error` is a trait object: a fat pointer (data pointer + vtable
  pointer) representing some unknown concrete type that implements
  `Error`.
- `Box<dyn Error>` heap-allocates that concrete error and returns a
  type-erased handle.
- The `?` operator can convert any `E: Error` into `Box<dyn Error>`
  automatically (via `From<E>` impls), so you can mix error types from
  different libraries on a single `?`-chain.

This is the rough analog of C#'s `Exception` base class — but explicit
and statically typed. Heavier-typed Rust would use a custom enum for
errors; for ad-hoc internal helpers like this, `Box<dyn Error>` is fine.

### 5.7 The `?` operator desugar

```rust
let code = QrCode::new(url.as_bytes())?;
```

Desugars (roughly) to:

```rust
let code = match QrCode::new(url.as_bytes()) {
    Ok(v) => v,
    Err(e) => return Err(From::from(e)),
};
```

The `From::from(e)` is what makes `?` flexible: if the error type of `?`
doesn't match the function's return type, the compiler tries to convert
via the `From` trait. This is how `qrcode::types::QrError` and
`image::ImageError` both flow into a single
`Box<dyn std::error::Error>` return.

### 5.8 The `#[cfg(test)]` test module

```rust
#[cfg(test)]
mod tests {
    use super::instance_probe_response;
    ...

    #[test]
    fn instance_probe_response_has_expected_marker_headers() {
        let response = instance_probe_response();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);
        ...
    }
}
```

`#[cfg(test)]` marks the module as compiled **only** during `cargo test`.
The module name conventionally is `tests`, but it's just a normal module
nested inside the file — which is why it can `use super::...` to reach
private items. This is one of the major ergonomic wins of having tests
in the same file: they can poke at private internals without exposing
them publicly.

`assert_eq!` is a macro (note the `!`). On failure it panics with both
sides of the comparison printed.

---

## Part 6 — Async Concurrency, `select!`, Pattern Matching (`ws.rs`)

`ws.rs` is the WebSocket handler, and showcases real async control flow.

### 6.1 Handlers as `async fn`

```rust
pub async fn ws_handler(
    ws: Option<WebSocketUpgrade>,
    Query(params): Query<HashMap<String, String>>,
    State(rs): State<RouterState>,
) -> impl IntoResponse {
    ...
}
```

The parameter destructuring is worth noting:

- `ws: Option<WebSocketUpgrade>` — axum tries to extract a
  `WebSocketUpgrade` from the request. If the request is not a WebSocket
  upgrade (just a plain `GET /`), the extractor returns `None`. This is
  how the same handler serves both browser GETs (returning the SPA HTML)
  and WebSocket upgrades (entering the WS loop).
- `Query(params): Query<HashMap<String, String>>` — pattern destructuring
  in the parameter list. `Query<T>` is a tuple struct; we're matching it
  open and binding the inner `HashMap` to `params` directly.
- `State(rs): State<RouterState>` — same pattern, unwrapping the
  extractor type to get at the inner state.

This kind of parameter-list pattern matching is super common in Rust;
it's one of the biggest ergonomic differences from C#.

### 6.2 Constant-time comparison and `subtle::ConstantTimeEq`

```rust
let provided = params.get("t").map(String::as_str).unwrap_or("");
let token = rs.app.token().await;

if !bool::from(provided.as_bytes().ct_eq(token.as_bytes())) {
    return StatusCode::UNAUTHORIZED.into_response();
}
```

This compares the user-provided token against the real token in
**constant time** — i.e. without short-circuiting on the first byte
mismatch — to prevent timing-side-channel attacks. `ConstantTimeEq::ct_eq`
returns a `subtle::Choice` (a thin wrapper around `u8`); we explicitly
convert it with `bool::from`. The wrapper exists so the compiler can't
optimize the constant-time pattern away.

Why bother in a LAN-only app? The cost is essentially nothing, and the
norm is "always compare secrets in constant time". The AI made the
defensive choice; in security-sensitive code you should too.

### 6.3 `params.get("t").map(String::as_str).unwrap_or("")`

This chain is a tiny lesson in `Option`:
- `.get("t")` returns `Option<&String>`.
- `.map(String::as_str)` returns `Option<&str>` — `as_str` borrows the
  `String` as a `&str`. Note the *function-pointer* style here:
  `String::as_str` is a method, but you can pass it as a value to `map`.
- `.unwrap_or("")` collapses `Option<&str>` into `&str` by substituting
  `""` for `None`.

No allocations. No copies. A few pointer/length manipulations.

### 6.4 `ws.on_upgrade(move |socket| handle_socket(socket, rs.app))`

`on_upgrade` takes a closure that will be called once the HTTP→WS
upgrade completes, and returns a response. The closure takes the
upgraded `WebSocket` and returns a future. The `move` keyword forces the
closure to capture `rs.app` by ownership; otherwise the closure would
borrow it, and the borrow would not live long enough.

### 6.5 `tokio::select!` — racing futures

```rust
loop {
    tokio::select! {
        msg = socket.recv() => {
            match msg {
                Some(Ok(Message::Text(text))) => { ... }
                Some(Ok(Message::Close(_))) | None => break,
                Some(Err(_)) => break,
                _ => {}
            }
        }
        event = rx.recv() => {
            match event {
                Ok(StateEvent::ActiveChanged(active)) => { ... }
                Ok(StateEvent::PairingUrlRefreshed) => {}
                Err(broadcast::error::RecvError::Lagged(_)) => {}
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    }
}
```

`select!` polls multiple async expressions concurrently and runs the
arm whose future completes first. The C# equivalent is
`await Task.WhenAny(...)` followed by a `switch`, but `select!` is more
ergonomic and supports cancellation safety, biased ordering, and
pattern-matching the result inline.

In this loop we want to:
- Read a command from the socket, *or*
- Forward a state event to the client, *or*
- Notice the socket closed.

`select!` lets us do all three in a single `loop` without spawning
auxiliary tasks. Whichever happens first is handled; the other future is
dropped (cancelled). For this to be safe, the futures must be
**cancellation safe** — losing one mid-flight must not corrupt state.
Both `socket.recv()` and `broadcast::Receiver::recv` are documented as
cancellation-safe.

### 6.6 Deep pattern matching

```rust
Some(Ok(Message::Text(text))) => { ... }
Some(Ok(Message::Close(_))) | None => break,
```

You can match arbitrarily deep into nested enums and bind variables
along the way. `text` here is bound to the inner string slice without
intermediate `match` blocks. The `|` (or-pattern) lets multiple shapes
share one arm. This is the C# 13 pattern-matching syntax fully realized
and applied to every type.

### 6.7 `tokio::task::spawn_blocking`

```rust
let result = tokio::task::spawn_blocking(move || dispatch(cmd)).await;
```

Why? `dispatch` calls into `enigo`, which performs blocking system calls
to inject keystrokes (via SendInput on Windows, X11/Wayland calls on
Linux). Doing that on the async runtime's worker thread would stall *all*
async tasks scheduled there for the duration of the system call.

`spawn_blocking` ships the closure to a dedicated thread pool meant for
blocking work. The returned future yields a `Result<T, JoinError>`. We
`.await` it and triple-match:
- `Ok(Ok(()))` → success
- `Ok(Err(e))` → keystroke injection succeeded reaching enigo, but enigo
  reported an error
- `Err(_)` → the spawn_blocking task itself panicked

One async function, three failure modes, all handled.

### 6.8 Why `move` is everywhere here

```rust
ws.on_upgrade(move |socket| handle_socket(socket, rs.app))
```

```rust
let result = tokio::task::spawn_blocking(move || dispatch(cmd)).await;
```

Both closures need to own their captures because they will outlive the
calling function (axum stores the upgrade closure for the request
duration; `spawn_blocking` ships the closure to another thread). The
compiler's borrow checker enforces this — it would refuse to let you
omit `move` here, with an error explaining exactly which lifetime
constraint failed.

### 6.9 The `Result<(), ()>` pattern

```rust
async fn send_msg(socket: &mut WebSocket, msg: &ServerMessage<'_>) -> Result<(), ()> {
    let text = serde_json::to_string(msg).map_err(|_| ())?;
    socket.send(Message::Text(text)).await.map_err(|_| ())
}
```

`Result<(), ()>` is a degenerate result that carries no information
beyond success/failure. We use it because the caller only cares "did the
send succeed?" and there's nothing useful to do with the error besides
break the loop. The `.map_err(|_| ())` discards the actual error type,
making the function compatible with `?`. Cheap, ergonomic, expressive.

The `<'_>` on `&ServerMessage<'_>` is an **anonymous lifetime**: "this
borrow has *some* lifetime, but I don't care to name it". Rust 2018+
inferred lifetime elision would let us drop it entirely in many places,
but having a generic parameter on `ServerMessage` forces us to mention
it.

---

## Part 7 — Static Init, Iterators, `LazyLock` (`profiles.rs`)

`profiles.rs` is heavy on iterator combinators and shows a thread-safe
lazy-init idiom that is the modern Rust replacement for `lazy_static!`.

### 7.1 `LazyLock` — once-on-first-access initialization

```rust
static GENERIC: LazyLock<ActionMap> = LazyLock::new(|| {
    let mut m = HashMap::new();
    m.insert(ActionName::PlayPause, key(KeyName::Space));
    ...
    m
});
```

Things to notice:

- `static` declares a value that lives for the whole program. Unlike
  `const` (compile-time evaluated, inlined at every use), a `static`
  has a fixed memory address.
- `LazyLock<T>` is the standard library's once-cell. The first thread to
  access it runs the initializer; subsequent accesses see the cached
  value without locking. Internally, this is a one-shot synchronization
  primitive (a state machine driven by atomic CAS).
- The initializer is a closure with no captures (`||`) — it can be a
  function pointer.

C# parallel: `Lazy<T>` with `LazyThreadSafetyMode.ExecutionAndPublication`,
held in a `static readonly` field.

Why use `LazyLock` here instead of building the maps at startup in
`main`? Because the maps are only needed inside `resolve_action`, and
they're read-only after construction. The lazy approach defers the
allocation until the first WebSocket connection arrives.

### 7.2 Helper constructors and the `vec![]` macro

```rust
fn key(k: KeyName) -> ActionRecipe {
    ActionRecipe {
        key: Some(k),
        mods: vec![],
        combo: None,
    }
}
```

`vec![]` is a macro that creates an empty `Vec<Modifier>`. Note: it does
**not** allocate when empty — `Vec::new()` (which `vec![]` desugars to
for the empty case) starts with no heap buffer until the first push. So
this empty `vec![]` is just three zero words on the stack: pointer
0/dangling, length 0, capacity 0.

`mods: mods.to_vec()` later does allocate, copying each `Modifier`
into a fresh heap buffer. Modifiers are `Copy`, so the copy is just a
`memcpy`.

### 7.3 The `?` on `Option`

```rust
fn format_combo(keys: &[KeyName]) -> Option<String> {
    let first = *keys.first()?;
    if keys.iter().all(|key| *key == first) {
        return Some(format!("{}×{}", format_key(first), keys.len()));
    }
    Some(keys.iter().map(|key| format_key(*key)).collect::<Vec<_>>().join(" "))
}
```

`keys.first()` returns `Option<&KeyName>`. The `?` on it short-circuits:
if `None`, the function returns `None`; otherwise we get `&KeyName` and
`*` dereferences it to `KeyName` (which is `Copy`, so no move issue).

Yes, `?` works for `Option`, not just `Result` — anything that
implements `Try`/`FromResidual`. Same operator, two contexts.

### 7.4 Iterator chains — `iter`, `map`, `filter_map`, `collect`

```rust
fn bindings_for_profile(profile: ProfileName) -> ProfileBindings {
    ALL_ACTIONS
        .iter()
        .filter_map(|action| {
            resolve_action(Some(profile), *action)
                .and_then(format_recipe)
                .map(|binding| (*action, binding))
        })
        .collect()
}
```

This is dense, so let's unpack:

- `ALL_ACTIONS.iter()` — borrows the slice and produces an iterator of
  `&ActionName`. Iterators are *lazy*; nothing happens until you
  `.collect()` or otherwise consume.
- `.filter_map(|action| ...)` — for each item, run the closure; if it
  returns `Some(x)`, yield `x`; if `None`, skip.
- `resolve_action(Some(profile), *action)` returns
  `Option<&'static ActionRecipe>`.
- `.and_then(format_recipe)` is the `Option` flatMap: if `Some(r)`, call
  `format_recipe(r)` (which itself returns `Option<String>`); if `None`,
  stay `None`.
- `.map(|binding| (*action, binding))` packages each `binding` with its
  action key into a tuple `(ActionName, String)`.
- `.collect()` materializes the iterator. The target type
  `ProfileBindings` is `HashMap<ActionName, String>`, and the compiler
  picks the right `FromIterator` impl that builds a hashmap from
  `(K, V)` tuples.

Compare to LINQ:
```csharp
ALL_ACTIONS
    .Select(a => (Action: a, Recipe: ResolveAction(profile, a)))
    .Where(t => t.Recipe != null)
    .Select(t => (t.Action, FormatRecipe(t.Recipe)))
    .Where(t => t.Item2 != null)
    .ToDictionary(t => t.Action, t => t.Item2);
```

The Rust version is roughly equivalent but **statically dispatched**: each
combinator returns a unique iterator type (e.g. `FilterMap<Iter<...>, ...>`)
that the compiler inlines aggressively. There is *no* heap allocation in
the chain itself; allocation happens only at `collect` for the final
`HashMap`. LINQ has more boxing and allocates lambda objects per chain
step.

### 7.5 `or_else` for fallback chains

```rust
let specific = match profile.unwrap_or(ProfileName::Auto) {
    ProfileName::Youtube => YOUTUBE.get(&action),
    ProfileName::Netflix => NETFLIX.get(&action).or_else(|| GENERIC.get(&action)),
    ProfileName::Auto | ProfileName::Generic => GENERIC.get(&action),
};
specific.or_else(|| GENERIC.get(&action))
```

`Option::or_else(f)` returns `self` if `Some`, else calls `f()`. The
laziness matters: we don't hash into `GENERIC` unless we have to.

`profile.unwrap_or(ProfileName::Auto)` — `Option<ProfileName>` to
`ProfileName`, with `Auto` as the default for `None`.

---

## Part 8 — Slices, Mutable Borrows, External Crates (`keystrokes.rs`)

### 8.1 `&[T]` parameters

```rust
pub fn tap(key: KeyName, mods: &[Modifier]) -> Result<(), String> { ... }
pub fn combo(keys: &[KeyName]) -> Result<(), String> { ... }
```

`&[Modifier]` is a borrowed slice — a (pointer, length) pair viewing
some contiguous run of `Modifier`s. The caller can pass `&[]` (empty),
`&vec![Modifier::Shift]`, `&[Modifier::Ctrl, Modifier::Alt]`, or even an
array literal directly: `&[Modifier::Shift]`. All compile to the same
slice argument.

Why `&[T]` over `Vec<T>`? Because we only need to read. Taking `Vec<T>`
would force the caller to give us ownership; taking `&Vec<T>` would
needlessly couple us to the heap representation. `&[T]` is the
maximally flexible choice — analogous to taking `IReadOnlyList<T>` in
C#, but truly zero-cost.

### 8.2 `&mut self`-style mutation through external types

```rust
let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
for &m in mods {
    enigo
        .key(map_mod(m), Direction::Press)
        .map_err(|e| e.to_string())?;
}
enigo
    .key(map_key(key), Direction::Click)
    .map_err(|e| e.to_string())?;
for &m in mods.iter().rev() {
    enigo
        .key(map_mod(m), Direction::Release)
        .map_err(|e| e.to_string())?;
}
```

A few things:

- `let mut enigo = ...` declares a *binding* that allows mutation. By
  default, `let x = ...` gives you an immutable binding — that's
  unusual for someone coming from C#. Mutation must be opt-in.
- `for &m in mods` — pattern matching in the loop variable. `mods` is
  `&[Modifier]`; iterating yields `&Modifier`. We pattern-match
  `&m`, peeling off the borrow. `m` is now a `Modifier` by value.
  Works because `Modifier` is `Copy`.
- `mods.iter().rev()` — adapter that reverses iteration order, lazily,
  with no allocation. The release order should mirror press order in
  reverse (LIFO), which is what `rev()` gives us.
- `.map_err(|e| e.to_string())` — `Result<T, E1>` → `Result<T, E2>` by
  applying a closure to the error. Here we collapse enigo's specific
  error type to a `String` so this function's error type stays simple.
- `?` propagates the `Err` upward. If any keystroke fails, we return
  immediately and the surrounding code handles it.

### 8.3 Why `Enigo` is not `Send`

```rust
pub fn tap(key: KeyName, mods: &[Modifier]) -> Result<(), String> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
    ...
}
```

Each function constructs a fresh `Enigo`. Why?

`Enigo` holds platform-specific resources (Win32 input handles, X11
display pointers, etc.) that are not `Send` — they cannot be moved
between threads safely. If we kept a long-lived `Enigo` in `AppState`,
we'd have to wrap it in something thread-local-ish. By constructing
ad-hoc inside each `spawn_blocking` task, we sidestep the whole problem
at the cost of a small per-call setup. The AI's reasoning was that the
setup cost is microseconds and the architectural simplification is huge.

`Send` and `Sync` are *auto-traits*: the compiler infers them based on
whether all your fields are `Send`/`Sync`. You can also opt out with
`!Send` markers (rare) or implement them `unsafe`-ly when you know
better than the compiler (we'll see that in `power.rs`).

---

## Part 9 — Interior Mutability, `Cell`, `Drop` (`tray.rs`)

### 9.1 `include_bytes!` — file contents at compile time

```rust
const ACTIVE_ICON: &[u8] = include_bytes!("../assets/icon-active.png");
const INACTIVE_ICON: &[u8] = include_bytes!("../assets/icon-inactive.png");
```

`include_bytes!("path")` is a macro that, at compile time, reads the
file and produces a `&'static [u8; N]` containing the bytes. The path
is relative to the source file. The bytes end up in `.rodata`.

So `ACTIVE_ICON` is just a pointer + length into a constant section of
the EXE — no I/O, no allocation, no failure path. The icons that
`build.rs` generates are baked directly into the binary.

Sister macros: `include_str!("path")` for UTF-8 strings, `include!("path")`
to include another Rust source file (rarely used).

### 9.2 `Cell<T>` — single-threaded interior mutability

```rust
pub struct TrayHandle {
    _icon: TrayIcon,
    active_item: CheckMenuItem,
    autolaunch_item: CheckMenuItem,
    pairing_url: Arc<RwLock<String>>,
    active: Cell<bool>,
}
```

`Cell<T>` is the cheapest form of interior mutability: it lets you
mutate `T` through a shared `&Cell<T>` reference. There is no lock and
no atomic — `Cell` is **single-threaded only** (it's `!Sync`).

Why use `Cell<bool>` for `active` instead of just `bool`? Because the
tray handle is held immutably by the tray loop, but several methods
(`set_active`, `refresh_tooltip`) need to update `active` through
`&self`, not `&mut self`:

```rust
impl TrayHandle {
    pub fn set_active(&self, active: bool) {
        self.active.set(active);
        ...
    }
    ...
}
```

If we declared `active: bool`, then `set_active` would have to take
`&mut self`, and every caller would need `&mut TrayHandle`. The whole
"interior mutability" concept is Rust's way of keeping the public API
ergonomic (most methods take `&self`) while allowing controlled
mutation.

This is the major gear-change for someone coming from C#: in C#, every
field can be mutated through a class reference. In Rust, mutation
through a shared reference *requires* one of `Cell`, `RefCell`,
`Mutex`, `RwLock`, or atomics. The kind tells you what kind of
sharing you're paying for.

| Type             | Threaded? | Cost                | When to use          |
|------------------|-----------|---------------------|----------------------|
| `Cell<T>`        | No        | Zero                | Small `Copy` data   |
| `RefCell<T>`     | No        | Runtime borrow check | Larger non-`Copy`   |
| `Mutex<T>`       | Yes       | OS mutex / futex    | Mutually exclusive  |
| `RwLock<T>`      | Yes       | Reader-writer lock  | Read-heavy          |
| `AtomicXxx`      | Yes       | One CPU op          | Single primitive    |

### 9.3 The `_icon` and `_ctx` underscore prefix

```rust
_icon: TrayIcon,
```

Rust warns about unused fields. Prefixing the field name with `_`
silences the warning while keeping the field alive. Why keep it? **Drop
order**. The `TrayIcon` registers OS handles in its constructor; when
it's dropped, those handles are released. Holding it in the struct
keeps the icon visible for the life of `TrayHandle`. We don't need to
*read* the field — we just need its `Drop` to run when `TrayHandle`
drops.

This RAII-via-field trick is *the* canonical way to model
"I want X to be alive as long as Y is alive" in Rust.

### 9.4 `Box<dyn std::error::Error>` again

```rust
pub fn build_tray(...) -> Result<(TrayHandle, MenuIds), Box<dyn std::error::Error>> { ... }
```

Same pattern as in `http.rs`. We compose errors from `muda` (menu
construction), `tray-icon` (tray construction), and `image` (icon
decoding) into a single boxed error. The `?` operator handles
conversions automatically.

The return tuple `(TrayHandle, MenuIds)` is just a value tuple, used
because we have two related things to return (the live handle and the
menu item IDs needed by `main.rs` for event dispatch).

### 9.5 Format strings with Unicode escapes

```rust
fn tooltip(active: bool, pairing_url: &str) -> String {
    format!(
        "Sofamote \u{2014} {}\n{}",
        if active { "Active" } else { "Paused" },
        pairing_url
    )
}
```

`\u{2014}` is the em dash. Inside `format!`, `{}` is the positional
placeholder and the arguments fill in left-to-right. `if-as-expression`
(`if active { "Active" } else { "Paused" }`) returns a value — `if` is
an expression in Rust, not a statement. The branches must have the
same type.

`format!` allocates a fresh `String`. Cheap, safe, idiomatic.

---

## Part 10 — Conditional Compilation, Modules per Platform (`autolaunch.rs`)

```rust
pub fn set_auto_launch(enabled: bool) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    platform::set_auto_launch(enabled, &exe)
}

#[cfg(target_os = "windows")]
mod platform { ... }

#[cfg(target_os = "linux")]
mod platform { ... }

#[cfg(target_os = "macos")]
mod platform { ... }

#[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
mod platform { ... }
```

This is the Rust idiom for "one public function, three implementations".

The `#[cfg(...)]` attribute on each `mod platform` block is a compile-time
filter. Exactly one of the four blocks compiles per target, and the
resulting `mod platform` exposes one `set_auto_launch(bool, &PathBuf)`
function. The outer `set_auto_launch` doesn't care which one.

C# parallel: `#if WINDOWS` preprocessor blocks, plus partial classes per
RID. Rust's version is more structured because each branch is its own
module with its own `use`s and helpers.

### 10.1 The Windows registry interaction

```rust
let hkcu = RegKey::predef(HKEY_CURRENT_USER);
let run = hkcu
    .open_subkey_with_flags(RUN_KEY, KEY_SET_VALUE | KEY_QUERY_VALUE)
    .map_err(|e| e.to_string())?;

cleanup_legacy_auto_launch(&run).map_err(|e| e.to_string())?;

if enabled {
    let cmd = format!("\"{}\"", exe.display());
    run.set_value(APP_NAME, &cmd).map_err(|e| e.to_string())
} else {
    run.delete_value(APP_NAME).or_else(|_| Ok(()))
}
```

The `winreg` crate is a thin wrapper over the Win32 registry API. Of
note:

- `exe.display()` returns a printable form of the `PathBuf`. We can't
  just `format!("\"{}\"", exe)` because `Path`/`PathBuf` are not `Display`
  (paths can be non-UTF-8 on some OSes; `Display` would lossily convert).
- `delete_value(...).or_else(|_| Ok(()))` — if deletion fails (e.g.
  because the value didn't exist), swallow it and return `Ok`.

### 10.2 `let-else` pattern (Linux/Mac platform code)

In Linux:

```rust
let Some(config_dir) = dirs::config_dir() else {
    return Ok(());
};
```

`let-else` is "try to bind via this pattern, else early-return". This
example is in the Windows `remove_legacy_wrappers` function. It's a
cleaner alternative to `match` or `if let` for "I want to bail if the
pattern doesn't match".

C# parallel: there isn't a clean one. You'd write
`if (!TryGetConfigDir(out var configDir)) return; ...`.

### 10.3 The `if let Err(e) ... ErrorKind::NotFound` idiom

```rust
match run.delete_value(value_name) {
    Ok(()) => {}
    Err(e) if e.kind() == ErrorKind::NotFound => {}
    Err(e) => return Err(e),
}
```

A *match guard* (`if e.kind() == ...`) lets you add a runtime predicate
to an arm. We're saying: "OK if it succeeded; OK if the failure is
'not found'; propagate any other error."

C# parallel: `catch (FileNotFoundException) { }`. The Rust version is
more general — match guards can do anything.

---

## Part 11 — Iterators with Side Effects, Network I/O (`net.rs`)

```rust
pub fn list_lan_ips() -> Vec<IpAddr> {
    local_ip_address::list_afinet_netifas()
        .map(|ifaces| {
            ifaces
                .into_iter()
                .map(|(_, ip)| ip)
                .filter(|ip| ip.is_ipv4() && !ip.is_loopback() && !ip.is_unspecified())
                .collect()
        })
        .unwrap_or_default()
}
```

Two fresh things here:

- `into_iter()` consumes the `Vec`, yielding owned items. `iter()`
  would borrow, yielding references. Choose by whether you want to
  keep using the vec after.
- `.unwrap_or_default()` — `Result::unwrap_or_default` returns the inner
  value or `T::default()`. For `Vec<IpAddr>`, default is the empty vec.

```rust
pub fn pick_lan_ip(previous: Option<IpAddr>) -> String {
    let candidates = list_lan_ips();

    if let Some(prev) = previous {
        if candidates.contains(&prev) {
            return prev.to_string();
        }
    }

    if let Ok(default) = local_ip_address::local_ip() {
        if candidates.contains(&default) {
            return default.to_string();
        }
    }

    candidates
        .into_iter()
        .next()
        .map(|ip| ip.to_string())
        .unwrap_or_else(|| "127.0.0.1".to_string())
}
```

`unwrap_or_else(|| ...)` is the lazy companion to `unwrap_or(value)`.
We use the lazy form when computing the default has any cost — here,
allocating a `String` from `"127.0.0.1"`. With `unwrap_or`, the default
is computed eagerly even if not needed.

This function's logic: "prefer the previously-shown IP if still
present; else prefer the OS's default route IP if present; else any
LAN IP; else loopback." It's purely a string in the end because we
just stuff it into a URL — no need for typed IP handling downstream.

---

## Part 12 — `unsafe`, FFI, `Box`, Raw Pointers (`power.rs`)

`power.rs` is the closest the codebase comes to "C with extra steps".
It calls into Win32 directly and manages a callback-driven OS
notification. This is where the abstractions thin out.

### 12.1 `unsafe extern "system"` callback

```rust
unsafe extern "system" fn callback(
    context: *const c_void,
    r#type: u32,
    _setting: *const c_void,
) -> u32 {
    if (r#type == PBT_APMRESUMESUSPEND || r#type == PBT_APMRESUMEAUTOMATIC)
        && !context.is_null()
    {
        let sender = &*(context as *const UnboundedSender<()>);
        sender.send(()).ok();
    }
    0
}
```

Multiple unfamiliar pieces:

- `extern "system"` — the calling convention. On x64 Windows this
  matches `WINAPI` (which is `__stdcall` on x86, `__fastcall` on x64).
  The compiler emits the right register/stack handling so Win32 can
  call this function.
- `unsafe fn` — the function is itself unsafe to call. Anyone calling
  it must wrap the call in an `unsafe { ... }` block. Win32 will be
  doing that for us.
- `*const c_void` — a raw pointer (no aliasing/lifetime info, like C's
  `const void *`). Raw pointers are the only way to bridge to C ABIs.
- `r#type` — `type` is a Rust keyword; the `r#` prefix is the *raw
  identifier* syntax that lets you use a keyword as a name. Win32's
  callback signature uses `Type`; we match it.
- `&*(context as *const UnboundedSender<()>)` — three steps:
  1. Cast the void pointer to a typed pointer.
  2. Dereference (`*`) to get the value.
  3. Re-borrow (`&`) to make a safe reference.
   This entire dance is sound only because we know `context` was
   originally a `Box<UnboundedSender<()>>` (set up below) and is still
   alive (the Drop impl unregisters before freeing).

### 12.2 Box-and-leak idiom for stable callback pointers

```rust
pub fn register(tx: UnboundedSender<()>) -> Option<ResumeRegistration> {
    let ctx = Box::new(tx);
    let context_ptr = &*ctx as *const UnboundedSender<()> as *const c_void;

    let mut params = Box::new(DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS {
        Callback: Some(callback),
        Context: context_ptr as *mut c_void,
    });

    let handle = unsafe {
        RegisterSuspendResumeNotification(
            &mut *params as *mut _ as HANDLE,
            DEVICE_NOTIFY_CALLBACK,
        )
    };

    if handle == 0 {
        tracing::warn!("RegisterSuspendResumeNotification failed; resume detection disabled");
        return None;
    }

    Some(ResumeRegistration { handle, _ctx: ctx, _params: params })
}
```

Let me walk through the key gymnastics:

- `Box::new(tx)` heap-allocates the sender behind a unique pointer.
  Why heap? Because we're handing the *address* to Win32. If we kept
  `tx` on the stack, the address would be invalidated when `register`
  returned. The `Box` puts it on the heap with a stable address.
- `&*ctx as *const UnboundedSender<()> as *const c_void` — borrow the
  boxed value, cast to typed pointer, cast to void pointer. The
  resulting raw pointer is *not* tracked by the borrow checker; it can
  outlive any borrow. That's exactly why this is dangerous and why we
  manage the lifetime manually with `_ctx`.
- The `params` box is similar — Win32 reads the struct from a stable
  address.
- We store both boxes in `ResumeRegistration` so they live as long as
  the registration. The leading `_` keeps the compiler from complaining
  that we don't read them; we hold them only for their `Drop` and
  stable-address properties.

When `ResumeRegistration` drops:

```rust
impl Drop for ResumeRegistration {
    fn drop(&mut self) {
        unsafe { UnregisterSuspendResumeNotification(self.handle); }
    }
}
```

We unregister first, then the boxes drop in struct field order
(`_ctx` and `_params`), freeing the heap memory. Order matters: if we
freed `_ctx` before unregistering, Win32 might call our callback with
a dangling pointer. The Drop impl runs before field drops, so we're
safe.

### 12.3 `unsafe impl Send + Sync`

```rust
unsafe impl Send for ResumeRegistration {}
unsafe impl Sync for ResumeRegistration {}
```

Normally `Send` and `Sync` are auto-derived. Here we have raw pointers
inside `DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS`, which makes the whole
struct `!Send` by default. The author asserts manually with an
`unsafe impl` that this struct is *actually* safe to send between
threads — because the only field touched cross-thread is the boxed
`UnboundedSender` (which is itself `Send + Sync`), and the
`HPOWERNOTIFY` is opaque.

The `unsafe` keyword on the impl is the author's signed promise that
the assertion holds. The compiler trusts it; if you're wrong, undefined
behavior follows.

This is the textbook example of "I know better than the compiler about
the runtime invariants." It's used sparingly and conservatively.

### 12.4 The `imp::` indirection and `pub use`

```rust
#[cfg(not(target_os = "windows"))]
mod imp {
    use tokio::sync::mpsc::UnboundedSender;
    pub struct ResumeRegistration;
    pub fn register(_tx: UnboundedSender<()>) -> Option<ResumeRegistration> { None }
}

pub use imp::ResumeRegistration;

pub fn register_resume_notifier(tx: UnboundedSender<()>) -> Option<ResumeRegistration> {
    imp::register(tx)
}
```

`pub use imp::ResumeRegistration;` re-exports the type from the inner
module so callers can refer to `power::ResumeRegistration` directly,
hiding the `imp` indirection. This pattern lets the same public name
mean different concrete types per platform — same external API, totally
different implementation. Compare to a C# partial class with platform-
specific files.

---

## Part 13 — Sync I/O, `TcpListener`, Manual HTTP (`single_instance.rs`)

This module enforces "only one Sofamote process at a time" by trying to
bind the port. If binding fails, we probe the existing instance, and if
it speaks the right marker, we exit silently.

### 13.1 Constants with explicit types

```rust
pub const INSTANCE_PROBE_PATH: &str = "/.well-known/sofamote-instance";
pub const INSTANCE_HEADER_NAME: &str = "x-sofamote-instance";
pub const INSTANCE_HEADER_VALUE: &str = "1";

const PROBE_WINDOW: Duration = Duration::from_secs(2);
const CONNECT_TIMEOUT: Duration = Duration::from_millis(150);
const READ_TIMEOUT: Duration = Duration::from_millis(200);
const RETRY_DELAY: Duration = Duration::from_millis(100);
```

`const` values are evaluated at compile time and inlined at every use.
`Duration::from_secs` is a `const fn` (one of many in the std library),
so it's usable in `const` context. Without `const fn`, you'd need
`static` plus a `LazyLock`.

### 13.2 An enum as a return code

```rust
pub enum ClaimResult {
    Primary(TcpListener),
    Exit(i32),
}
```

This expresses two outcomes with payloads: either we own the port (and
hand back the listener), or we should exit (with a code). Compare to
C#'s `out` parameters or tuples — Rust enums make this kind of multi-
shape return value the default.

### 13.3 Sync `TcpListener` with non-blocking mode

```rust
fn bind_primary_listener(port: u16) -> io::Result<TcpListener> {
    let listener = TcpListener::bind((Ipv4Addr::UNSPECIFIED, port))?;
    listener.set_nonblocking(true)?;
    Ok(listener)
}
```

`TcpListener::bind` is *synchronous* — it blocks the calling thread
until the kernel accepts the bind. The result is `io::Result<TcpListener>`
where `io::Result<T> = Result<T, io::Error>`.

We set non-blocking mode so that when the listener is later handed to
the tokio runtime via `tokio::net::TcpListener::from_std`, tokio can
treat it as an async I/O source without blocking on `accept`.

The `(Ipv4Addr::UNSPECIFIED, port)` tuple uses the `ToSocketAddrs`
trait to get converted into an iterator of `SocketAddr` — Rust's
standard library has dozens of these tiny conversion traits to support
ergonomic call sites.

### 13.4 Manual HTTP request

```rust
fn probe_instance_once(addr: SocketAddr, connect_timeout: Duration, read_timeout: Duration) -> io::Result<bool> {
    let mut stream = TcpStream::connect_timeout(&addr, connect_timeout)?;
    stream.set_read_timeout(Some(read_timeout))?;
    stream.set_write_timeout(Some(read_timeout))?;

    let request = format!(
        "GET {INSTANCE_PROBE_PATH} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
    );
    stream.write_all(request.as_bytes())?;

    let response = read_response_headers(&mut stream)?;
    Ok(is_sofamote_probe_response(&response))
}
```

We avoid bringing in `reqwest` or `hyper` for this 1-shot probe — we
literally write an HTTP/1.1 request as a byte string. `format!` with
`{INSTANCE_PROBE_PATH}` directly inlines the constant via Rust 2021's
"named arguments in format strings" feature: any identifier in scope
can appear inside `{}`.

### 13.5 Searching for `\r\n\r\n` with `windows`

```rust
if response.windows(4).any(|window| window == b"\r\n\r\n") {
    break;
}
```

`response.windows(4)` returns an iterator of `&[u8]` slices, each 4
bytes long, sliding by 1. `b"\r\n\r\n"` is a byte-string literal of
type `&[u8; 4]`. We're searching for the HTTP header terminator.

Why not use a `String::contains`? Because `response` is `Vec<u8>` and
we don't want to allocate a `String` from it (it might not even be
valid UTF-8 yet). Slicing on bytes is cheaper.

### 13.6 `let-else` again

```rust
let Ok(text) = std::str::from_utf8(response) else {
    return false;
};
```

If the bytes aren't UTF-8, return early. The `text` binding is in
scope for the rest of the function — much cleaner than a nested `match`.

### 13.7 `eq_ignore_ascii_case`

```rust
name.trim().eq_ignore_ascii_case(INSTANCE_HEADER_NAME)
```

`&str` exposes a rich set of methods for ASCII-fast paths. This is
faster than constructing two lowercase copies and comparing.

### 13.8 Tests using `spawn_stub_server`

```rust
fn spawn_stub_server<F>(handler: F) -> (SocketAddr, std::thread::JoinHandle<()>)
where
    F: FnOnce(std::net::TcpStream) + Send + 'static,
{ ... }
```

A *generic function* over a closure type. The trait bounds are:
- `FnOnce(TcpStream)` — callable once with a `TcpStream`.
- `Send` — can move to another thread.
- `'static` — captures nothing borrowed (or borrows that live forever).

`std::thread::spawn` requires `FnOnce + Send + 'static`. We forward
those bounds onto the helper. This is precisely how strongly-typed
generic concurrency is in Rust: every requirement is in the signature.

C# parallel: `Action<TcpClient>` plus the closure's captures being
ambiently-thread-safe. C# doesn't enforce `Send + 'static` at the type
system level — at runtime you can hit thread-affinity bugs that Rust
makes impossible.

---

## Part 14 — Build Scripts (`build.rs`)

`build.rs` is a Rust program that runs *at build time*. It's compiled
and executed by Cargo before the main crate is compiled. It can:

- Generate code (`.rs` files dumped into `OUT_DIR`).
- Generate assets.
- Tell Cargo to set environment variables, link libraries, rerun on
  changes, and so on.

Sofamote uses it to:
1. Rasterize the tray icon at build time and write PNGs to `assets/`.
2. Build a Windows `.ico`.
3. On Windows, embed the `.ico` into the EXE so File Explorer shows it.

C# parallel: MSBuild target with `<Exec>` or a source generator. Rust
makes this a normal Rust program with full crate access.

### 14.1 Reading env vars at compile time

```rust
let out = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("assets");
```

`env!("FOO")` is a macro that reads an environment variable **at
compile time** and inlines its value as a `&'static str`. If the var
is missing at compile time, the program fails to compile.
`CARGO_MANIFEST_DIR` is set by Cargo to the directory containing
`Cargo.toml`, so we end up with an absolute path to `server/assets/`.

Compare to `std::env::var("FOO")` which reads at runtime and returns
`Result<String, VarError>`.

### 14.2 Manual binary file format

The `write_ico` function constructs an ICO file by hand:

```rust
let directory_size = 6 + (16 * images.len());
let mut offset = directory_size as u32;
let mut icon = Vec::new();
let mut payload = Vec::new();

icon.extend_from_slice(&0u16.to_le_bytes());
icon.extend_from_slice(&1u16.to_le_bytes());
icon.extend_from_slice(&(images.len() as u16).to_le_bytes());
```

Note the `u16::to_le_bytes()` and `extend_from_slice` pattern. ICO
files are little-endian; `to_le_bytes` converts a `u16` to a `[u8; 2]`
in little-endian byte order. `extend_from_slice` appends a slice to
the `Vec<u8>` in O(n) amortized.

This is the kind of byte-fiddling code that Rust handles gracefully
because (a) integer-to-bytes conversions are infallible primitive
methods, (b) `Vec<u8>` has a familiar `Buffer`-like API, and (c)
the borrow checker keeps you from accidentally aliasing while writing.

### 14.3 `cargo:rerun-if-changed=`

```rust
println!("cargo:rerun-if-changed=build.rs");
```

Cargo watches `build.rs`'s stdout for `cargo:` directives. This one
says "rerun me if `build.rs` changes". Without it, Cargo's default is
to rerun on any source change in the package, which is wasteful for
build scripts.

You can emit other directives: `cargo:rustc-link-lib=...`,
`cargo:rustc-env=KEY=VALUE`, etc.

---

## Part 15 — Threading, Channels, Runtime Wiring (`main.rs` revisited)

Now that the building blocks are familiar, let's reread `main.rs` as a
runtime architecture document.

### 15.1 The thread plan

Sofamote runs:

1. **Main thread** — owns the tray icon's hidden HWND. On Windows, must
   pump Win32 messages for the tray to receive clicks.
2. **One std::thread::spawn'd thread** — hosts the tokio runtime, which
   in turn schedules many async tasks: the HTTP server, WS handlers,
   tray-command consumer, resume-notifier consumer.
3. **`spawn_blocking` worker pool** — implicit, owned by tokio. Runs
   blocking work like `enigo` keystroke injection.
4. **OS-managed thread** — Win32 calls our resume callback from a
   DLL thread it owns.

Communication between them:

| From → To                          | Channel                                   |
|------------------------------------|-------------------------------------------|
| Tray (main) → tokio                | `tokio::sync::mpsc::unbounded` of `TrayCmd` |
| Tokio → tray (main)                | `tokio::sync::broadcast` of `StateEvent`  |
| Tokio → main, "I'm ready"          | `std::sync::mpsc` oneshot of `StartupSignal` |
| Tokio → main, "shut down"          | `tokio::sync::oneshot` of `()`            |
| Win32 callback → tokio             | `tokio::sync::mpsc::unbounded` of `()`    |

This many-channels architecture is the canonical Rust answer to "I have
mixed sync/async code on multiple threads." Each channel has a
specific direction and use; nothing shares mutable state via locks
beyond `pairing_url` and `AppState`.

### 15.2 `tokio::sync::mpsc::unbounded_channel`

```rust
let (tray_tx, tray_rx) = tokio::sync::mpsc::unbounded_channel::<TrayCmd>();
```

Multi-producer, single-consumer. *Unbounded*: no backpressure, but
sending never blocks (or `await`s). Since the tray loop is sync, a
bounded channel would force us to either drop or block, neither of
which is great for a UI. Unbounded is the right call here because
TrayCmd events are user-initiated and rare.

The send side returns `Result` but never fails for backpressure
reasons — only if the receiver has been dropped (the runtime is gone).

### 15.3 `tokio::sync::oneshot`

```rust
let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();
```

A oneshot channel transports exactly one message. Sending consumes the
sender; receiving consumes the receiver. Perfect for "fire once and
done" signals like shutdown.

`std::mpsc::channel::<StartupSignal>()` — used for the same purpose
but on the std (sync) side. Choosing std vs tokio here depends on
which side reads/writes async vs sync. The startup signal is sent
from inside `run_server` (async) and read from the main thread (sync,
non-tokio), so a tokio oneshot would be wrong — `try_recv` doesn't
exist on the tokio version in the same form.

### 15.4 The supervisor loop

```rust
let mut backoff_secs: u64 = 1;
loop {
    let serve_fut = axum::serve(listener, router.clone()).into_future();
    tokio::pin!(serve_fut);

    tokio::select! {
        biased;
        _ = &mut shutdown_rx => {
            tracing::info!("shutting down");
            return;
        }
        res = &mut serve_fut => {
            match res {
                Ok(()) => tracing::warn!("axum::serve completed; rebinding in {backoff_secs}s"),
                Err(e) => tracing::error!("axum::serve exited: {e}; rebinding in {backoff_secs}s"),
            }
        }
    }
    ...
}
```

Several pieces:

- `tokio::pin!(serve_fut)` — *pins* the future to the stack. This is
  necessary because `select!` polls the future by `&mut` reference,
  and `Future`s in Rust are address-sensitive once polled (their
  internal state-machine may contain self-references). Pinning
  guarantees the address won't change.
- `biased;` — instructs `select!` to check arms in order rather than
  pseudo-randomly. We want `shutdown_rx` to win if both are ready.
- `&mut shutdown_rx` — we re-borrow rather than consuming, because we
  want to come back to it on the next loop iteration if it didn't fire.

The reasoning behind this whole supervisor loop: if the OS-level
listener somehow dies (e.g. interface flap during sleep/resume),
`axum::serve` returns and we rebind with exponential backoff. Without
this, you'd silently lose connectivity until restart.

### 15.5 The resume flow

```rust
let (resume_tx, resume_rx) = tokio::sync::mpsc::unbounded_channel::<()>();
let _resume_registration = power::register_resume_notifier(resume_tx);
```

We construct the channel, hand the sender to Win32 (as a boxed
context pointer), and keep the registration handle in `_resume_registration`.

The leading `_` is mandatory here for the same Drop-ordering reason as
in `tray.rs`: the registration must stay alive for the whole `main`,
or Win32 will free it and stop calling us. Dropping at end of `main` is
exactly what we want; the OS callback unregistration runs before the
program exits.

The receiver is moved into the resume handler task inside
`run_server`. When the registration drops at end of `main`, the
sender drops, the channel closes, and the resume task exits cleanly.

### 15.6 `tokio::spawn` and detached tasks

```rust
let state_for_cmds = Arc::clone(&state);
tokio::spawn(async move {
    while let Some(cmd) = tray_rx.recv().await {
        match cmd { ... }
    }
});
```

`tokio::spawn` schedules an async task on the runtime and returns a
`JoinHandle<T>` (which we ignore = "detached"). The closure is `async
move`, meaning:
- `async` — it produces a future.
- `move` — it owns its captures.

The future is polled by the runtime to completion (or until the
runtime shuts down). When the channel is closed, `recv()` returns
`None`, the loop exits, and the task ends.

C# parallel: `Task.Run(async () => { ... });`. The fire-and-forget
nature is similar.

### 15.7 The closure that defers reading the URL

```rust
let pairing_url_for_qr = Arc::clone(&pairing_url);
let current_qr_url = move || -> String {
    let url = pairing_url_for_qr
        .read()
        .expect("pairing_url lock poisoned")
        .clone();
    let base = url.split('?').next().unwrap_or(&url);
    format!("{}qr.png", base)
};
```

This closure captures `pairing_url_for_qr` by move and is called every
time the user clicks "Show QR" or the startup-open-QR fires. Each call
re-reads the lock, so post-resume URL refreshes are reflected.

The explicit return type `-> String` is unusual — the compiler can
infer it. The author probably wrote it for clarity / to make the
intent obvious in a multi-line closure. It compiles to the same code.

`.expect("pairing_url lock poisoned")` — `RwLock::read` returns
`Result<RwLockReadGuard, PoisonError>`. A lock is "poisoned" when a
panic happens while holding the write guard. We `expect` because if
that happens, our state is corrupt and crashing is the right answer.

### 15.8 The Win32 message pump (`run_event_loop` on Windows)

```rust
#[cfg(target_os = "windows")]
fn run_event_loop<F: FnMut() -> bool>(mut tick: F) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        DispatchMessageW, PeekMessageW, TranslateMessage, MSG, PM_REMOVE, WM_QUIT,
    };
    unsafe {
        let mut msg: MSG = std::mem::zeroed();
        loop {
            while PeekMessageW(&mut msg, 0, 0, 0, PM_REMOVE) != 0 {
                if msg.message == WM_QUIT {
                    return;
                }
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
            if !tick() {
                return;
            }
            std::thread::sleep(Duration::from_millis(16));
        }
    }
}
```

Worth noting:

- `F: FnMut() -> bool` — generic over closures. The compiler
  monomorphizes one copy per concrete closure; no boxing.
- `std::mem::zeroed()` — produces a zero-initialized `MSG`. This is
  unsafe in general because not every type can be safely zeroed
  (`bool`, references, etc.), but `MSG` is a plain repr-C struct and
  `0` is a valid value.
- The `unsafe` block surrounds all FFI calls. Each Win32 function is
  declared `unsafe`, so calling it requires this scope.
- We sleep 16 ms (~60 Hz polling) to keep CPU low. Win32 messages
  drain via `PeekMessage`, `tick()` does our app logic, repeat.

The non-Windows variant is just `loop { tick(); sleep(16ms); }` — no
message pump needed because tray-icon on Mac/Linux uses different
mechanisms.

### 15.9 The graceful shutdown dance

```rust
drop(tray_handle);
shutdown_tx.send(()).ok();
let _ = std::thread::spawn(move || {
    std::thread::sleep(Duration::from_millis(1500));
    std::process::exit(0);
});
server_thread.join().ok();
```

Step by step:
1. `drop(tray_handle)` removes the icon immediately (the user clicked Quit).
2. `shutdown_tx.send(())` tells the server task to exit cleanly.
3. We spawn a "watchdog" thread that hard-exits after 1.5s.
4. We `join` the server thread, which waits for it to finish.

If the server exits cleanly within 1.5s, the watchdog never fires. If
it hangs, the watchdog kills us anyway. This avoids a class of
shutdown bugs where some hung future blocks process exit indefinitely.

`std::process::exit(0)` is a brutal exit — no Drop impls run beyond
this point. It's fine here because we want to ensure exit no matter what.

---

## Part 16 — Cross-Cutting Concepts You'll See Everywhere

A few patterns worth recognizing on sight, with where they appear.

### 16.1 The `?`-operator chain

```rust
fn generate_qr_png(url: &str) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let code = QrCode::new(url.as_bytes())?;
    ...
    dynamic.write_to(&mut Cursor::new(&mut buf), image::ImageFormat::Png)?;
    Ok(buf)
}
```

Read every `?` as "if this fails, return early". The function's return
type must be a `Result` (or `Option`). The error type must be
convertible from each `?`'s error type via `From`. Once you internalize
this, half of Rust looks like Go-without-the-`if-err-return`-boilerplate.

### 16.2 The `move` keyword on closures

You'll see `move` on every closure that's:
- Spawned (`tokio::spawn`, `thread::spawn`).
- Stored (axum routes, callbacks).
- Crossed thread/task boundaries.

It says "consume captures by move, not by reference". If the closure
needs to outlive the function that built it, you almost always want
`move`.

### 16.3 `Arc::clone(&x)` vs `x.clone()`

Both work. The community style is `Arc::clone(&x)` because it makes
the cheap pointer-bump explicit and grep-friendly, distinct from a
"deep clone" that allocates. If you grep for `.clone()`, you find the
expensive clones; `Arc::clone` is a separate, visually distinct
operation.

### 16.4 `&str` vs `String`, `&[T]` vs `Vec<T>`, `&Path` vs `PathBuf`

The first of each pair is the *borrowed view*; the second is the
*owned heap allocation*. As a rule:
- Function params: take the borrowed form unless you need ownership.
- Struct fields: usually own (storing borrows ties the struct's
  lifetime to whatever it borrows).
- Return values: usually own (a returned borrow can't escape its
  source).

### 16.5 `match` is exhaustive

```rust
match cmd {
    Command::Key { key, mods } => keystrokes::tap(key, &mods),
    Command::Combo { keys } => keystrokes::combo(&keys),
    Command::Action { name, profile } => { ... }
    ...
    Command::TypeText { text } => keystrokes::type_text(&text),
}
```

If you forget a variant, the compiler refuses. This is the C# 13
"exhaustive switch expression" experience, but enforced by default.
When you add a new `Command` variant, every `match` on it lights up
red until you handle it.

### 16.6 `tracing` over `println!`

Sofamote uses the `tracing` crate's macros (`tracing::info!`, etc.)
instead of bare `println!`. `tracing` is a structured-logging
framework that supports filtering, JSON output, distributed tracing
spans, etc. `tracing_subscriber::fmt()` configures the global
subscriber at startup.

C# parallel: Microsoft.Extensions.Logging.

### 16.7 `Result<(), String>` is a common simple-error idiom

```rust
pub fn tap(key: KeyName, mods: &[Modifier]) -> Result<(), String> { ... }
```

A `String` error type means "something went wrong, and here's a
message". It's the Rust equivalent of returning `false` in C and
setting `errno`. It loses error chaining but is dead simple. For
internal helpers, fine; for library APIs, prefer a typed error enum.

### 16.8 `Default::default()` and the `Default` trait

You'll see `Settings::default()`, `Vec::new()`, `HashMap::new()`,
`MSG: zeroed`. `Default` is a trait giving "the canonical empty/zero
value". `derive(Default)` works for any struct whose fields are all
`Default`.

---

## Part 17 — Where to Look in `Cargo.lock`, `target/`, and the Toolchain

A few practical things that aren't language features but matter:

- **`Cargo.lock`** — like `package-lock.json` or `packages.lock.json`.
  Locks transitive dep versions. Commit it for binaries; for
  libraries the convention varies.
- **`target/`** — build outputs. `target/debug/sofamote`,
  `target/release/sofamote`. Ignored by `.gitignore`.
- **`rustc`** — the compiler. `rustup` is the toolchain manager.
- **`cargo build` / `cargo run`** — debug build by default. Add
  `--release` for optimized builds. Sofamote's `npm start` invokes
  this.
- **`cargo check`** — type-check without codegen. Fast. Use it during
  edit cycles; only `cargo build` when you actually need an artifact.
- **`cargo clippy`** — extra lints. Worth running, not configured here.

---

## Part 18 — A Reading Order for Going Deeper

Now that you've seen these idioms in real code, the ranked list of
things to deepen on, in order:

1. **Ownership & borrowing.** Re-read the [Rust Book chapter 4]. Try to
   express *why* every `&` and `&mut` in this codebase is what it is.
2. **Lifetimes.** Read the lifetime-elision rules; understand
   `ServerMessage<'a>` and why we can drop the `'a` in most function
   signatures.
3. **Async runtime mechanics.** Read [tokio's "tokio internals"]
   and Without Boats's blog posts on `Pin`. Then re-read `main.rs`'s
   supervisor loop and `select!` to see why each piece is the way it is.
4. **Trait objects vs generics.** Understand when `Box<dyn Trait>`
   buys you something vs `impl Trait` vs `<T: Trait>`. The Sofamote
   code uses all three.
5. **`unsafe` and FFI.** Re-read `power.rs` and the [Rustonomicon]'s
   chapter on "Working with Raw Pointers" to understand the
   safety obligations.
6. **`serde` derive macros.** Skim serde's docs to understand how
   `#[serde(tag = "type")]`, `#[serde(default)]`, etc. transform JSON.
7. **`tracing` and structured logging.** Useful in any nontrivial
   server.

[Rust Book chapter 4]: https://doc.rust-lang.org/book/ch04-00-understanding-ownership.html
[tokio's "tokio internals"]: https://tokio.rs/tokio/topics
[Rustonomicon]: https://doc.rust-lang.org/nomicon/

---

## Quick-Reference Cheat Sheet

| C# pattern                                  | Rust pattern                                             |
|---------------------------------------------|----------------------------------------------------------|
| `class Foo` with reference semantics        | `struct Foo` + `Arc<Foo>` (or `Box<Foo>`)                |
| `struct Foo` (value type)                   | `struct Foo` (default)                                  |
| `IDisposable` + `using`                     | `Drop` trait + scope-end                                |
| `null`                                      | `Option<T>::None`                                       |
| `throw new Exception(...)` (recoverable)    | `return Err(...)`                                       |
| `try { ... } catch (...)`                   | `match ... { Err(e) => ... }` or `?`                    |
| `Task<T>`                                   | `impl Future<Output = T>`                               |
| `await`                                     | `.await`                                                 |
| `Task.WhenAny`                              | `tokio::select!`                                        |
| `lock (obj) { ... }`                        | `Mutex<T>::lock()` / `RwLock<T>::write()`               |
| `Interlocked.Increment`                     | `AtomicUsize::fetch_add(1, ...)`                        |
| `IEnumerable<T>` + LINQ                     | `Iterator` trait + combinators                          |
| `T?` (nullable)                             | `Option<T>`                                             |
| `static readonly`                           | `static`, `const`, or `LazyLock`                        |
| Generic constraint `where T : IFoo`         | `where T: Foo`                                          |
| `interface`                                 | `trait`                                                 |
| `partial class` per platform                | `mod` + `#[cfg(target_os = "...")]`                     |
| `[Conditional("DEBUG")]`                    | `#[cfg(debug_assertions)]`                              |
| `out` parameter                             | Return a tuple or an enum                               |
| `dynamic`                                   | `Box<dyn Trait>` or enum (no good direct equivalent)    |
| Reflection-based DI                         | Generics + traits at compile time                       |
| `Span<T>`                                   | `&[T]`                                                  |
| `ReadOnlySpan<T>`                           | `&[T]`                                                  |
| `Memory<T>`                                 | `Vec<T>` / `Box<[T]>`                                   |
| `unsafe { fixed { ... } }`                  | `unsafe { ... }` with raw pointers                      |

---

## Closing Note

This codebase is small (~1.5 kLOC of Rust) but exercises a wide
spectrum of the language: async runtime hosting, FFI to Win32,
embedded resources, build scripts, multi-threaded message-passing,
custom serialization, and platform-conditional compilation. If you
can read every line of Sofamote and explain what each `&`, `mut`,
`Arc`, `'a`, `?`, `move`, `dyn`, and `unsafe` is doing — and *why* —
you're past the "intermediate Rust" mark.

The shortest pithy summary I have for someone making the transition:

> C# is "trust the runtime; check at runtime."
> Rust is "prove at compile time; pay nothing at runtime."

Everything weird about Rust is downstream of that one trade.
