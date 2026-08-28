"use client";

import { useEffect, useState } from "react";

export function PwaRuntime() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js");
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return online ? null : (
    <div className="fixed inset-x-0 top-0 z-[100] bg-amber-950 px-3 py-2 text-center text-xs text-amber-100" role="status">
      Offline — conversa e documentos aguardam conexão com a VPS.
    </div>
  );
}
