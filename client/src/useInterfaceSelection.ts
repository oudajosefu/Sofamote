import { useState } from "react";
import type { InterfaceName } from "./types";

const KEY = "rmc.interface";

export function useInterfaceSelection(): [InterfaceName, (i: InterfaceName) => void] {
  const [iface, setIface] = useState<InterfaceName>(() => {
    const stored = localStorage.getItem(KEY);
    if (stored === "media" || stored === "fullControl" || stored === "trackpad") return stored;
    return "media";
  });

  function updateIface(next: InterfaceName) {
    setIface(next);
    localStorage.setItem(KEY, next);
  }

  return [iface, updateIface];
}
