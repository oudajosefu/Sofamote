import { useMemo } from "react";
import { RemoteUI } from "./RemoteUI";
import { useSocket } from "./useSocket";
import { buildWsUrl, rememberToken } from "./pairing";

export function App() {
  const token = useMemo(() => rememberToken(), []);
  const url = useMemo(() => (token ? buildWsUrl(token) : null), [token]);
  const { state, active, profiles, bindings, send } = useSocket({ url });

  if (!token) {
    return (
      <div className="empty">
        <h1>Not paired</h1>
        <p>Scan the QR code printed in the server console to pair this device.</p>
      </div>
    );
  }

  return <RemoteUI state={state} active={active} profiles={profiles} bindings={bindings} send={send} />;
}
