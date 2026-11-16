import { useEffect, useId, useState } from 'react';
import type { SessionCredentials } from '../utils/session-vault';
import {
  ASSISTANT_PERMISSIONS,
  chatGPTDenialRedirect,
  clientAllowsRequest,
  describeScope,
  disconnectChatGPT,
  grantChatGPTAccess,
  includedBy,
  isLoopbackRedirect,
  listChatGPTConnections,
  loadChatGPTClient,
  parseChatGPTAuthorization,
  redirectMatches,
  revokeChatGPTConnection,
  type ChatGPTClient,
  type ChatGPTConnection,
} from '../utils/chatgpt';
import { PageHeader } from './PageHeader';
import './ChatGPTConnect.css';

interface ChatGPTConnectProps {
  session: SessionCredentials;
  search: string;
  onLogout: () => void;
}

interface AssistantPermissionsProps {
  clientName: string;
  /** The scopes the client asked for, space-separated. Only these are offered. */
  requested: string;
  ticked: ReadonlySet<string>;
  onToggle: (scope: string, on: boolean) => void;
  disabled?: boolean;
}

/** The consent page's checkboxes. Seeing shows is always granted, so it is
 * ticked and fixed; everything else the client asked for starts ticked and
 * can be withheld. A permission another one includes (seeing the Rolodex,
 * while editing it is ticked) is ticked and fixed for as long as that one is.
 * What is ticked is exactly what gets granted. */
export function AssistantPermissions({ clientName, requested, ticked, onToggle, disabled }: AssistantPermissionsProps) {
  const id = useId();
  const asked = new Set(requested.split(' '));
  // Only a permission that is on offer can hold another one ticked.
  const granting = new Set([...ticked].filter((scope) => asked.has(scope)));
  return (
    <fieldset className="chatgpt-connect__permissions" disabled={disabled}>
      <legend className="chatgpt-connect__legend">Allow {clientName} to</legend>
      {ASSISTANT_PERMISSIONS.filter((permission) => asked.has(permission.scope)).map((permission, index) => {
        const holder = includedBy(permission.scope, granting);
        const fixed = !!permission.required || !!holder;
        const detail = permission.required ? 'Always included.' : holder ? `Included while “${holder.label}” is ticked.` : permission.detail;
        const detailId = `${id}-${index}-detail`;
        return (
          <div key={permission.scope} className="chatgpt-connect__permission">
            <label className="chatgpt-connect__permission-label">
              <input
                type="checkbox"
                checked={fixed || ticked.has(permission.scope)}
                disabled={fixed}
                aria-describedby={detail ? detailId : undefined}
                onChange={(event) => onToggle(permission.scope, event.target.checked)}
              />
              <span>{permission.label}</span>
            </label>
            {detail && <p id={detailId} className="chatgpt-connect__permission-detail">{detail}</p>}
          </div>
        );
      })}
    </fieldset>
  );
}

export function ChatGPTConnect({ session, search, onLogout }: ChatGPTConnectProps) {
  const request = parseChatGPTAuthorization(search);
  const clientId = request?.client_id;
  const redirectUri = request?.redirect_uri;
  const [client, setClient] = useState<ChatGPTClient | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set(request?.scope.split(' ') ?? []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!clientId || !redirectUri) return;
    void loadChatGPTClient(clientId).then((next) => {
      if (cancelled) return;
      if (!redirectMatches(next.redirectUris, redirectUri)) {
        setFailed(true);
      } else {
        setClient(next);
        setFailed(false);
      }
      setLoading(false);
    }).catch(() => {
      if (!cancelled) { setFailed(true); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [clientId, redirectUri, retry]);

  const valid = request && client && clientAllowsRequest(client, request);
  // Any program on this computer can listen on a loopback port and register
  // under any name, so a request returning there says so plainly.
  const loopback = !!request && isLoopbackRedirect(request.redirect_uri);

  return (
    <main className="chatgpt-connect">
      <PageHeader title="Connect an AI assistant" />
      <section className="chatgpt-connect__card">
        {!request || failed ? (
          <>
            <h2>Connection request unavailable</h2>
            <p role="alert">This request is invalid, expired, or couldn’t be checked. No access has been granted.</p>
            {request && <button className="btn btn--secondary" onClick={() => { setLoading(true); setFailed(false); setRetry((n) => n + 1); }}>Try again</button>}
            <a className="btn btn--ghost" href="/">Return to your shows</a>
          </>
        ) : loading ? (
          <p role="status">Checking the connection request…</p>
        ) : valid ? (
          <>
            <h2>{client.clientName} wants access to your account</h2>
            {/* The name above is whatever the client registered under, so the
                place access is actually sent sits right beneath it. */}
            <p className="chatgpt-connect__destination">
              Returns to <strong>{new URL(request.redirect_uri).host}</strong>{loopback ? ' on this computer' : ''}. Access goes only there, whatever name the request uses.
            </p>
            {loopback && (
              <p className="chatgpt-connect__warning">
                This request came from an app on this computer, not a website. Allow it only if you just started connecting from Claude Code or another app you trust here: any program on this computer can ask under any name.
              </p>
            )}
            <p>Signed in as <strong>{session.username}</strong>. <button className="chatgpt-connect__switch" onClick={onLogout} disabled={busy}>Use a different account</button></p>
            <AssistantPermissions
              clientName={client.clientName}
              requested={request.scope}
              ticked={ticked}
              disabled={busy}
              onToggle={(scope, on) => setTicked((current) => {
                const next = new Set(current);
                if (on) next.add(scope); else next.delete(scope);
                return next;
              })}
            />
            <p className="chatgpt-connect__privacy">
              To act for you, our server receives the derived keys that decrypt your account’s data, and uses them only while {client.clientName} makes a request this connection allows.
              Those keys could unlock everything in the account, but {client.clientName} can only do what’s ticked above.
              Your password is never shared, and the connection can’t change your password, billing or account.
              Disconnect any time in Settings → AI assistants. That stops future access; information already shared may remain in your {client.clientName} conversations.
            </p>
            {error && <p role="alert">{error}</p>}
            <div className="chatgpt-connect__actions">
              <button className="btn btn--primary" disabled={busy} onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  const target = await grantChatGPTAccess(session, request, ticked);
                  window.location.assign(target);
                } catch {
                  setError('Couldn’t complete the connection. Check your connection and try again.');
                  setBusy(false);
                }
              }}>{busy ? 'Connecting…' : 'Allow access'}</button>
              <button className="btn btn--secondary" disabled={busy} onClick={() => window.location.assign(chatGPTDenialRedirect(request))}>Cancel</button>
            </div>
          </>
        ) : null}
      </section>
    </main>
  );
}

const longDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });

/** Connection management is loaded on request, so an offline Settings visit
 * neither fails nor needs to contact the connector service. */
export function ChatGPTSettings({ session }: { session: SessionCredentials }) {
  const [connections, setConnections] = useState<ChatGPTConnection[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState('');
  const connectorUrl = typeof window === 'undefined' ? '' : `${window.location.origin}/api/mcp`;

  return (
    <section className="settings__card chatgpt-settings" aria-labelledby="chatgpt-settings-heading">
      <h2 id="chatgpt-settings-heading" className="settings__card-title">AI assistants</h2>
      <p className="settings__hint">Work on your shows from Claude or ChatGPT through an optional connection. Access starts only after you sign in here and choose what it may do.</p>
      <details className="settings__details">
        <summary className="settings__details-summary"><span className="settings__details-title">Connect Claude or ChatGPT</span></summary>
        <div className="settings__details-body">
          <label className="section-field">
            <span className="section-field__label">Connector URL</span>
            <input className="section-field__input" readOnly value={connectorUrl} onFocus={(event) => event.target.select()} />
          </label>
          <button className="btn btn--secondary btn--sm" onClick={async () => {
            try { await navigator.clipboard.writeText(connectorUrl); setCopied(true); }
            catch { setCopied(false); setError('Select the connector URL above and copy it.'); }
          }}>{copied ? 'Copied' : 'Copy connector URL'}</button>
          <p className="settings__hint">
            <strong>Claude:</strong> open Customize → Connectors → Add custom connector, paste the URL, then connect and choose what to allow here.
            In Claude Code, run <code className="chatgpt-settings__command">claude mcp add --transport http icanrunashow {connectorUrl}</code>
          </p>
          <p className="settings__hint">
            <strong>ChatGPT:</strong> go to chatgpt.com/plugins, choose + → Add custom MCP server, paste this URL with OAuth authentication, then Create as a plugin. Custom MCP servers depend on your ChatGPT plan and workspace settings.
          </p>
          <p className="settings__hint">Use the URL from your deployed app. A local development address can’t be reached by either assistant.</p>
        </div>
      </details>
      <button className="btn btn--secondary btn--sm" disabled={busy} onClick={async () => {
        setBusy(true); setError(''); setNotice('');
        try { setConnections(await listChatGPTConnections(session)); }
        catch { setError('Couldn’t load connections. Check your connection and try again.'); }
        finally { setBusy(false); }
      }}>{busy ? 'Working…' : connections === null ? 'Manage connections' : 'Refresh connections'}</button>
      {connections !== null && (
        connections.length === 0 ? <p className="settings__hint" role="status">{notice || 'No AI assistants are connected.'}</p> : (
          <>
            <ul className="chatgpt-settings__connections">{connections.map((connection) => (
              <li key={connection.id} className="chatgpt-settings__connection">
                <div className="chatgpt-settings__connection-info">
                  <span className="chatgpt-settings__connection-name">{connection.clientName}</span>
                  <span>Can {describeScope(connection.scope)}.</span>
                  <span className="chatgpt-settings__connection-dates">Connected {longDate(connection.createdAt)} · Expires {longDate(connection.expiresAt)}</span>
                </div>
                <button
                  className="btn btn--secondary btn--sm"
                  disabled={busy}
                  aria-label={`Disconnect ${connection.clientName}, connected ${longDate(connection.createdAt)}`}
                  onClick={async () => {
                    setBusy(true); setError(''); setNotice('');
                    try {
                      await revokeChatGPTConnection(session, connection.id);
                      setConnections((current) => (current ?? []).filter((other) => other.id !== connection.id));
                      setNotice(`Disconnected ${connection.clientName}. It no longer has access to your account.`);
                    } catch { setError(`Couldn’t disconnect ${connection.clientName}. Access has not been revoked. Try again.`); }
                    finally { setBusy(false); }
                  }}
                >Disconnect</button>
              </li>
            ))}</ul>
            {notice && <p className="settings__hint" role="status">{notice}</p>}
            <button className="btn btn--danger btn--sm" disabled={busy} onClick={async () => {
              setBusy(true); setError(''); setNotice('');
              try { await disconnectChatGPT(session); setConnections([]); setNotice('Disconnected. No AI assistant has access to your account now.'); }
              catch { setError('Couldn’t disconnect. Access has not been revoked. Try again.'); }
              finally { setBusy(false); }
            }}>Disconnect all</button>
          </>
        )
      )}
      {error && <p className="settings__sweep-error" role="alert">{error}</p>}
    </section>
  );
}
