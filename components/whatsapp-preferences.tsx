"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, Check, Loader2, MessageCircle } from "lucide-react";
import { act } from "@/lib/client";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";

type Preferences = { opt_in: boolean; enabled: boolean; invite_url: string | null };

function inviteURL(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "chat.whatsapp.com" &&
      !url.username && !url.password && !url.port && /^\/[A-Za-z0-9]{16,64}$/.test(url.pathname)
      ? url.origin + url.pathname : null;
  } catch { return null; }
}

export function WhatsAppPreferences({ open, onOpenChange, preview = false }: {
  open: boolean; onOpenChange: (value: boolean) => void; preview?: boolean;
}) {
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(""); setSaved(false); setPreferences(null);
    if (preview) {
      setPreferences({ opt_in: false, enabled: false, invite_url: null });
      return;
    }
    act("whatsapp_preferences").then(value => {
      if (!cancelled) setPreferences(value);
    }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [open, preview]);

  async function toggle(opt_in: boolean) {
    setBusy(true); setError(""); setSaved(false);
    try {
      const value = preview ? { opt_in, enabled: false, invite_url: null }
        : await act("whatsapp_preferences_save", { opt_in });
      setPreferences(value); setSaved(true);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const url = preferences?.opt_in ? inviteURL(preferences.invite_url) : null;
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="app-dialog whatsapp-dialog">
      <DialogHeader>
        <DialogTitle>Notification settings</DialogTitle>
        <DialogDescription>Good engineering finds. A little bot wit. Straight to your WhatsApp group.</DialogDescription>
      </DialogHeader>
      {error && <p className="error" role="alert">{error}</p>}
      {!preferences && !error && <p className="whatsapp-loading" role="status"><Loader2 size={18} className="spin" /> Loading your preferences…</p>}
      {preferences && <>
        <label className="whatsapp-opt-in">
          <input type="checkbox" checked={preferences.opt_in} disabled={busy}
            onChange={e => void toggle(e.target.checked)} />
          <span>Notify me about top-tier drops via WhatsApp.<small>Reviewed articles, useful docs, and followed releases.</small></span>
        </label>
        {saved && <p className="whatsapp-saved" role="status"><Check size={14} /> {preview ? "Preview preference updated" : "Preference saved"}</p>}
        {preferences.opt_in && <section className="whatsapp-invite" aria-label="Join the WhatsApp group">
          <div className="whatsapp-invite-icon"><MessageCircle size={25} /></div>
          <span className="eyebrow">STACKSIGNAL · WHATSAPP</span>
          <h3>Your next useful rabbit hole.</h3>
          <p>Join our private group to receive curated alerts with a summary, why each find matters, and a link back to StackSignal.</p>
          {url ? <a className="whatsapp-join" href={url} target="_blank" rel="noopener noreferrer">Join the private group <ArrowUpRight size={17} /></a>
            : <p className="whatsapp-pending">Group access is being set up. Your preference is saved.</p>}
          {url && !preferences.enabled && <p className="whatsapp-pending">You can join now. Alerts will start when the bot is ready.</p>}
          <small>Joining is a separate step. Group members may see your WhatsApp name and phone number. Anyone with a shared invite link may be able to request access.</small>
        </section>}
        <p className="whatsapp-leave">To stop receiving messages, leave the WhatsApp group too. Switching this preference off does not remove you from the group.</p>
      </>}
    </DialogContent>
  </Dialog>;
}
