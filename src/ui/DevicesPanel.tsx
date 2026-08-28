"use client";

import { useCallback, useEffect, useState } from "react";
import { safeCoreFetch } from "@/lib/safe-core-client";

interface DeviceRow { deviceId: string; label: string; status: string; capabilities: string[]; lastSeenAt: string }
type Style = "compact" | "neutral" | "formal";

export function DevicesPanel() {
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [code, setCode] = useState<string | null>(null);
  const [telegramCode, setTelegramCode] = useState<string | null>(null);
  const [style, setStyle] = useState<Style>("neutral");
  const [address, setAddress] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [localPaired, setLocalPaired] = useState(false);

  const refresh = useCallback(async () => {
    const response = await safeCoreFetch("/api/devices");
    if (response.ok) setDevices(((await response.json()) as { devices: DeviceRow[] }).devices);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- remote state hydration.
    void refresh();
    void safeCoreFetch("/api/preferences").then(async (response) => {
      if (!response.ok) return;
      const body = (await response.json()) as { preferences: { style: Style; preferredAddress?: string } };
      setStyle(body.preferences.style);
      setAddress(body.preferences.preferredAddress ?? "");
    });
    void window.jarvisDesktop?.getCompanionStatus().then((value) => setLocalPaired(value.paired));
  }, [refresh]);

  const pair = async () => {
    const response = await safeCoreFetch("/api/devices/pair", { method: "POST", body: JSON.stringify({ mode: "create" }) });
    if (response.ok) setCode(String(((await response.json()) as { code: string }).code));
    else setStatus("Pareamento exige identidade Tailscale.");
  };

  const savePreferences = async () => {
    const response = await safeCoreFetch("/api/preferences", { method: "PUT", body: JSON.stringify({ style, preferredAddress: address }) });
    setStatus(response.ok ? "Preferências salvas." : "Não foi possível salvar preferências.");
  };

  const linkTelegram = async () => {
    const response = await safeCoreFetch("/api/telegram/link-codes", { method: "POST" });
    if (response.ok) setTelegramCode(String(((await response.json()) as { code: string }).code));
    else setStatus("Vínculo Telegram exige identidade Tailscale.");
  };

  const activateThisMac = async () => {
    if (!code || !window.jarvisDesktop) return;
    try {
      await window.jarvisDesktop.pairCompanion({ baseUrl: window.location.origin, code });
      setLocalPaired(true);
      setStatus("Este Mac foi pareado; token salvo no Keychain.");
    } catch {
      setStatus("Não foi possível parear este Mac.");
    }
  };

  return <section className="mx-auto w-full max-w-4xl space-y-8 p-4 pb-24" aria-label="Dispositivos">
    <div><p className="text-xs uppercase tracking-[.24em] text-cyan-300">Acesso privado</p><h1 className="text-xl text-ink-0">Dispositivos</h1></div>
    <div className="rounded-xl border border-white/10 p-4"><div className="flex items-center justify-between gap-4"><h2 className="text-sm text-ink-0">Mac companions</h2><button type="button" onClick={() => void pair()} className="min-h-11 rounded-lg border border-cyan-300/30 px-3 text-xs text-cyan-100">Gerar código</button></div>{code ? <div className="mt-4 flex flex-wrap items-center gap-3"><p className="font-mono text-2xl tracking-[.3em] text-cyan-200">{code}</p>{typeof window !== "undefined" && window.jarvisDesktop ? <button type="button" onClick={() => void activateThisMac()} className="min-h-11 rounded-lg border border-cyan-300/30 px-3 text-xs text-cyan-100">Ativar neste Mac</button> : null}</div> : null}{localPaired && typeof window !== "undefined" && window.jarvisDesktop ? <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => void window.jarvisDesktop?.addCompanionGrant()} className="min-h-11 rounded-lg border border-white/15 px-3 text-xs text-ink-1">Autorizar pasta</button><button type="button" onClick={() => void window.jarvisDesktop?.uploadCompanionFile("jarvis")} className="min-h-11 rounded-lg border border-white/15 px-3 text-xs text-ink-1">Subir arquivo</button></div> : null}<ul className="mt-4 space-y-2">{devices.map((device) => <li key={device.deviceId} className="flex justify-between gap-4 text-sm"><span>{device.label} · {device.status}</span><button type="button" disabled={device.status === "revoked"} onClick={async () => { await safeCoreFetch(`/api/devices/${device.deviceId}`, { method: "DELETE" }); await refresh(); }} className="text-rose-300">Revogar</button></li>)}</ul></div>
    <div className="rounded-xl border border-white/10 p-4"><div className="flex items-center justify-between gap-4"><div><h2 className="text-sm text-ink-0">Telegram privado</h2><p className="mt-1 text-xs text-ink-2">Grupos desativados. Envie /link CÓDIGO ao bot.</p></div><button type="button" onClick={() => void linkTelegram()} className="min-h-11 rounded-lg border border-cyan-300/30 px-3 text-xs text-cyan-100">Vincular</button></div>{telegramCode ? <p className="mt-4 font-mono text-xl tracking-[.2em] text-cyan-200">{telegramCode}</p> : null}</div>
    <div className="space-y-4 rounded-xl border border-white/10 p-4"><h2 className="text-sm text-ink-0">Personalidade</h2><label className="block text-xs text-ink-2">Estilo<select value={style} onChange={(event) => setStyle(event.target.value as Style)} className="mt-1 min-h-11 w-full bg-black p-2 text-ink-0"><option value="compact">Compacto</option><option value="neutral">Neutro</option><option value="formal">Formal</option></select></label><label className="block text-xs text-ink-2">Como chamar você<input value={address} maxLength={80} onChange={(event) => setAddress(event.target.value)} className="mt-1 min-h-11 w-full bg-black p-2 text-ink-0" /></label><button type="button" onClick={() => void savePreferences()} className="min-h-11 rounded-lg border border-cyan-300/30 px-4 text-sm text-cyan-100">Salvar</button>{status ? <p role="status" className="text-xs text-ink-1">{status}</p> : null}</div>
  </section>;
}
