"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, Check, Loader2, MessageCircle } from "lucide-react";
import { act } from "@/lib/client";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";

type Preferences = {
  opt_in: boolean; enabled: boolean; invite_url: string | null;
  registration: "unregistered" | "pending" | "registered";
  registered_at?: string | null; registration_source?: "user_confirmed" | "admin_confirmed" | null;
};
const empty: Preferences = { opt_in: false, enabled: false, invite_url: null, registration: "unregistered" };

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
  const [demo, setDemo] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [leave, setLeave] = useState(false);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(""); setSaved(false); setLeave(false); setPreferences(null);
    if (preview) { setPreferences(demo); return; }
    act("whatsapp_preferences").then(value => {
      if (!cancelled) setPreferences(value);
    }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
    // Demo state is restored when reopening, rather than resetting each toggle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, preview]);

  async function save(opt_in: boolean, confirm = false) {
    if (!preferences || busy) return;
    const previous = preferences;
    if (!confirm) setPreferences({ ...previous, opt_in,
      registration: opt_in ? "pending" : "unregistered" });
    setBusy(true); setError(""); setSaved(false);
    try {
      const value: Preferences = preview ? { ...demo, opt_in,
        registration: confirm ? "registered" : opt_in ? "pending" : "unregistered",
        registration_source: confirm ? "user_confirmed" : null }
        : await act(confirm ? "whatsapp_confirm_joined" : "whatsapp_preferences_save", confirm ? {} : { opt_in });
      setPreferences(value); setSaved(true);
      if (preview) setDemo(value);
      setLeave(!opt_in);
    } catch (e) { setPreferences(previous); setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const url = preferences?.opt_in ? inviteURL(preferences.invite_url) : null;
  const registered = preferences?.registration === "registered";
  const label = registered ? "Registered" : preferences?.opt_in ? "Waiting to join" : "Unregistered";
  return <Dialog open={open} onOpenChange={value => { if (!busy) onOpenChange(value); }}>
    <DialogContent className="app-dialog whatsapp-dialog" aria-busy={busy}>
      <DialogHeader>
        <DialogTitle>{leave ? "You’re unregistered" : "WhatsApp alerts"}</DialogTitle>
        <DialogDescription>{leave ? "Your StackSignal registration has been updated." : "Useful engineering finds. A little bot wit. One private group."}</DialogDescription>
      </DialogHeader>
      {error && <p className="error" role="alert">{error}</p>}
      {!preferences && !error && <p className="whatsapp-loading" role="status"><Loader2 size={18} className="spin" /> Loading your registration…</p>}
      {preferences && (leave ? <section className="whatsapp-invite" aria-label="Leave the WhatsApp group">
        <MessageCircle size={28} />
        <h3>One last step: leave the group.</h3>
        <p>Open WhatsApp → StackSignal → tap the group name → Exit group. You’ll stop receiving group messages after you leave.</p>
        <p>StackSignal cannot remove you from WhatsApp. You can register again here whenever you like.</p>
        <button className="primary" onClick={() => setLeave(false)}>Got it</button>
      </section> : <>
        <div className="whatsapp-registration" data-state={preferences.registration}>
          <span className="eyebrow">YOUR REGISTRATION</span>
          <strong>{registered && <Check size={16} />} {label}</strong>
          {registered && <small>{preferences.registration_source === "admin_confirmed" ? "Group membership confirmed by your administrator." : "You confirmed that you joined the group."}</small>}
        </div>
        <label className="whatsapp-opt-in">
          <input type="checkbox" role="switch" aria-label="WhatsApp registration" checked={preferences.opt_in} disabled={busy}
            onChange={e => void save(e.target.checked)} />
          <span>Notify me about top-tier drops via WhatsApp.<small>Reviewed articles, useful docs, and followed releases. You can register or unregister at any time.</small></span>
        </label>
        {saved && <p className="whatsapp-saved" role="status"><Check size={14} /> {preview ? "Preview registration updated" : "Registration saved"}</p>}
        {preferences.opt_in && <section className="whatsapp-invite" aria-label="Join the WhatsApp group">
          <div className="whatsapp-invite-icon"><MessageCircle size={25} /></div>
          <span className="eyebrow">STACKSIGNAL · WHATSAPP</span>
          <h3>{registered ? "You’re on the list." : "Your next useful rabbit hole."}</h3>
          <p>{registered ? "Curated alerts arrive in the StackSignal WhatsApp group. Registration here records your choice; WhatsApp controls actual membership." : "Join the group in WhatsApp, then confirm below. Each alert includes a summary, why it matters, and a link back to StackSignal."}</p>
          {url ? <a className="whatsapp-join" href={url} target="_blank" rel="noopener noreferrer">{registered ? "Open group invite" : "Join the group"} <ArrowUpRight size={17} /></a>
            : <p className="whatsapp-pending">{preview ? "Demo mode: the private invite is available after signing in." : "The invite is temporarily unavailable. Your choice is saved; please try again later."}</p>}
          {!registered && (url || preview) && <button className="primary whatsapp-confirm" disabled={busy} onClick={() => void save(true, true)}>{busy ? "Saving…" : "I’ve joined the group"}</button>}
          {!preferences.enabled && <p className="whatsapp-pending">Registration is open. Automatic alerts are awaiting activation.</p>}
          <small>Joining opens WhatsApp; complete the join there. Group members may see your WhatsApp name and phone number. Your confirmation is a declaration, not an automatic membership check.</small>
        </section>}
        <p className="whatsapp-leave">To stop group messages, unregister here and leave the WhatsApp group. Changing this switch cannot remove you from WhatsApp.</p>
      </>)}
    </DialogContent>
  </Dialog>;
}
