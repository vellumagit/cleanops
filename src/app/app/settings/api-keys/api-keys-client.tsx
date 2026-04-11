"use client";

import { useState } from "react";
import { Key, Copy, Check, Trash2, Plus, Eye, EyeOff, AlertTriangle } from "lucide-react";
import { createApiKeyAction, revokeApiKeyAction } from "./actions";

type ApiKeyRow = {
  id: string;
  key_prefix: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

export function ApiKeysClient({ keys }: { keys: ApiKeyRow[] }) {
  const [showCreate, setShowCreate] = useState(false);
  const [newKeyResult, setNewKeyResult] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  async function handleCreate() {
    if (!label.trim()) return;
    setCreating(true);
    setError(null);
    const result = await createApiKeyAction(label.trim());
    setCreating(false);

    if ("error" in result) {
      setError(result.error);
    } else {
      setNewKeyResult(result.rawKey);
      setShowCreate(false);
      setLabel("");
    }
  }

  async function handleRevoke(keyId: string) {
    if (!confirm("Revoke this API key? Any integrations using it will stop working immediately.")) return;
    setRevoking(keyId);
    const result = await revokeApiKeyAction(keyId);
    setRevoking(null);
    if (result.error) {
      alert(result.error);
    }
  }

  function handleCopy(text: string) {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const activeKeys = keys.filter((k) => !k.revoked_at);
  const revokedKeys = keys.filter((k) => k.revoked_at);

  return (
    <div className="space-y-6">
      {/* New key reveal banner */}
      {newKeyResult && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0 space-y-2">
              <p className="text-sm font-semibold text-foreground">
                Save your API key now — you won&apos;t be able to see it again
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded bg-zinc-900 px-3 py-2 text-xs font-mono text-zinc-100 overflow-x-auto">
                  {showKey ? newKeyResult : "sk_live_••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••"}
                </code>
                <button
                  onClick={() => setShowKey(!showKey)}
                  className="rounded-md border border-border p-2 text-muted-foreground hover:text-foreground transition-colors"
                  title={showKey ? "Hide" : "Show"}
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
                <button
                  onClick={() => handleCopy(newKeyResult)}
                  className="rounded-md border border-border p-2 text-muted-foreground hover:text-foreground transition-colors"
                  title="Copy to clipboard"
                >
                  {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
              <button
                onClick={() => setNewKeyResult(null)}
                className="text-xs text-muted-foreground hover:text-foreground underline"
              >
                I&apos;ve saved it — dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create key form */}
      {showCreate ? (
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <h3 className="text-sm font-semibold">Create new API key</h3>
          <div>
            <label htmlFor="key-label" className="text-xs text-muted-foreground">
              Label (e.g. &quot;Make.com production&quot;, &quot;Zapier&quot;)
            </label>
            <input
              id="key-label"
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="My integration"
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              maxLength={100}
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={creating || !label.trim()}
              className="rounded-md bg-foreground px-4 py-2 text-xs font-medium text-background hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {creating ? "Creating…" : "Generate key"}
            </button>
            <button
              onClick={() => {
                setShowCreate(false);
                setLabel("");
                setError(null);
              }}
              className="rounded-md border border-border px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 rounded-md bg-foreground px-4 py-2 text-xs font-medium text-background hover:opacity-90 transition-opacity"
        >
          <Plus className="h-3.5 w-3.5" />
          Create API key
        </button>
      )}

      {/* Active keys */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Active keys ({activeKeys.length})
        </h3>
        {activeKeys.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            No API keys yet. Create one to connect Make.com, Zapier, n8n, or any HTTP client.
          </p>
        ) : (
          <div className="space-y-2">
            {activeKeys.map((k) => (
              <div
                key={k.id}
                className="flex items-center gap-3 rounded-lg border border-border bg-card p-3"
              >
                <Key className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{k.label}</p>
                  <p className="text-xs text-muted-foreground">
                    <code className="font-mono">{k.key_prefix}••••••••</code>
                    {" · "}
                    Created {new Date(k.created_at).toLocaleDateString()}
                    {k.last_used_at && (
                      <>
                        {" · "}
                        Last used{" "}
                        {new Date(k.last_used_at).toLocaleDateString()}
                      </>
                    )}
                  </p>
                </div>
                <button
                  onClick={() => handleRevoke(k.id)}
                  disabled={revoking === k.id}
                  className="rounded-md border border-border p-2 text-muted-foreground hover:text-red-500 hover:border-red-500/30 transition-colors disabled:opacity-50"
                  title="Revoke key"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Revoked keys */}
      {revokedKeys.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Revoked keys ({revokedKeys.length})
          </h3>
          <div className="space-y-2">
            {revokedKeys.map((k) => (
              <div
                key={k.id}
                className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 opacity-50"
              >
                <Key className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate line-through">{k.label}</p>
                  <p className="text-xs text-muted-foreground">
                    <code className="font-mono">{k.key_prefix}••••••••</code>
                    {" · "}
                    Revoked {new Date(k.revoked_at!).toLocaleDateString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Usage instructions */}
      <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
        <h3 className="text-sm font-semibold">How to use your API key</h3>
        <p className="text-xs text-muted-foreground">
          Include your API key in the <code className="font-mono bg-muted px-1 py-0.5 rounded">Authorization</code> header of every request:
        </p>
        <pre className="rounded bg-zinc-900 px-3 py-2 text-xs font-mono text-zinc-100 overflow-x-auto">
{`curl -H "Authorization: Bearer sk_live_your_key_here" \\
     https://your-domain.com/api/v1/clients`}
        </pre>
        <div className="text-xs text-muted-foreground space-y-1">
          <p><strong>Available endpoints:</strong></p>
          <ul className="list-disc list-inside space-y-0.5 ml-2">
            <li><code className="font-mono bg-muted px-1 py-0.5 rounded">GET/POST /api/v1/clients</code> — List or create clients</li>
            <li><code className="font-mono bg-muted px-1 py-0.5 rounded">GET/PATCH/DELETE /api/v1/clients/:id</code></li>
            <li><code className="font-mono bg-muted px-1 py-0.5 rounded">GET/POST /api/v1/bookings</code> — List or create bookings</li>
            <li><code className="font-mono bg-muted px-1 py-0.5 rounded">GET/PATCH/DELETE /api/v1/bookings/:id</code></li>
            <li><code className="font-mono bg-muted px-1 py-0.5 rounded">GET/POST /api/v1/estimates</code> — List or create estimates</li>
            <li><code className="font-mono bg-muted px-1 py-0.5 rounded">GET/PATCH /api/v1/estimates/:id</code></li>
            <li><code className="font-mono bg-muted px-1 py-0.5 rounded">GET/POST /api/v1/invoices</code> — List or create invoices</li>
            <li><code className="font-mono bg-muted px-1 py-0.5 rounded">GET/PATCH /api/v1/invoices/:id</code></li>
          </ul>
        </div>
      </div>
    </div>
  );
}
