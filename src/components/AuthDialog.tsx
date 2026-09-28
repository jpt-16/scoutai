"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";

interface AuthDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AuthDialog({ open, onOpenChange }: AuthDialogProps) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("sending");
    setError(null);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/` },
    });

    if (signInError) {
      setStatus("error");
      setError(signInError.message);
      return;
    }
    setStatus("sent");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          setStatus("idle");
          setError(null);
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sign in</DialogTitle>
          <DialogDescription>
            AI film import is a paid feature for coaching staffs. Sign in with your email to get
            started — no password, just a link sent to your inbox.
          </DialogDescription>
        </DialogHeader>

        {status === "sent" ? (
          <p className="text-sm">
            Check <span className="font-semibold">{email}</span> for a sign-in link.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <input
              type="email"
              required
              autoFocus
              placeholder="coach@yourschool.edu"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="h-11 rounded-md border-2 border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring"
            />
            {error && <p className="text-destructive text-sm">{error}</p>}
            <Button type="submit" size="lg" disabled={status === "sending"}>
              {status === "sending" ? "Sending…" : "Send sign-in link"}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
