import { useEffect, useState } from 'react';
import type { SessionCredentials } from '../utils/session-vault';
import {
  chatGPTDenialRedirect,
  clientAllowsRequest,
  disconnectChatGPT,
  grantChatGPTAccess,
  listChatGPTConnections,
  loadChatGPTClient,
  parseChatGPTAuthorization,
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

export function ChatGPTConnect({ session, search, onLogout }: ChatGPTConnectProps) {
  const request = parseChatGPTAuthorization(search);
  const clientId = request?.client_id;
  const redirectUri = request?.redirect_uri;
  const [client, setClient] = useState<ChatGPTClient | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [allowWrites, setAllowWrites] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!clientId || !redirectUri) return;
    void loadChatGPTClient(clientId).then((next) => {
      if (cancelled) return;
      if (!next.redirectUris?.includes(redirectUri)) {
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
  const writeRequested = request?.scope.split(' ').includes('shows:write');

  return (
    <main className="chatgpt-connect">
      <PageHeader title="Connect to ChatGPT" />
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
            <h2>{client.clientName} wants access to your shows</h2>
            <p>Signed in as <strong>{session.username}</strong>. <button className="chatgpt-connect__switch" onClick={onLogout} disabled={busy}>Use a different account</button></p>
            <ul>
              <li>Read all your shows, including their lineup and running order.</li>
              {writeRequested && allowWrites && <li>Create shows and edit show details.</li>}
            </ul>
            {writeRequested && (
              <label className="chatgpt-connect__permission">
                <input type="checkbox" checked={allowWrites} onChange={(event) => setAllowWrites(event.target.checked)} disabled={busy} />
                Allow creating and editing shows
              </label>
            )}
            <p className="chatgpt-connect__privacy">
              You’re sharing derived encryption keys so our server can decrypt your shows for ChatGPT when you use the connection.
              Your password is never shared. Your Rolodex, contracts, settings and stored files aren’t available through this connection.
              You can disconnect in Settings at any time. Disconnecting stops future access; information already shared may remain in your ChatGPT conversations.
            </p>
            <p className="chatgpt-connect__destination">Returns to <strong>{new URL(request.redirect_uri).hostname}</strong>.</p>
            {error && <p role="alert">{error}</p>}
            <div className="chatgpt-connect__actions">
              <button className="btn btn--primary" disabled={busy} onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  const target = await grantChatGPTAccess(session, request, !!writeRequested && allowWrites);
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

/** Connection management is loaded on request, so an offline Settings visit
 * neither fails nor needs to contact the connector service. */
export function ChatGPTSettings({ session }: { session: SessionCredentials }) {
  const [connections, setConnections] = useState<ChatGPTConnection[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [disconnected, setDisconnected] = useState(false);
  const connectorUrl = typeof window === 'undefined' ? '' : `${window.location.origin}/api/mcp`;

  return (
    <section className="settings__card chatgpt-settings" aria-labelledby="chatgpt-settings-heading">
      <h2 id="chatgpt-settings-heading" className="settings__card-title">ChatGPT</h2>
      <p className="settings__hint">View and manage shows in ChatGPT through an optional connection. Access starts only after you sign in here and allow it.</p>
      <details className="settings__details">
        <summary className="settings__details-summary"><span className="settings__details-title">Connect your app</span></summary>
        <div className="settings__details-body">
          <p className="settings__hint">In ChatGPT, open Settings → Apps, enable developer mode if available, and create an app with this connector URL and OAuth authentication. Then connect it and approve access here. Custom apps depend on your ChatGPT plan and workspace settings.</p>
          <label className="section-field">
            <span className="section-field__label">Connector URL</span>
            <input className="section-field__input" readOnly value={connectorUrl} onFocus={(event) => event.target.select()} />
          </label>
          <button className="btn btn--secondary btn--sm" onClick={async () => {
            try { await navigator.clipboard.writeText(connectorUrl); setCopied(true); }
            catch { setCopied(false); setError('Select the connector URL above and copy it.'); }
          }}>{copied ? 'Copied' : 'Copy connector URL'}</button>
          <p className="settings__hint">Use the URL from your deployed app. A local development address can’t be reached by ChatGPT.</p>
        </div>
      </details>
      <button className="btn btn--secondary btn--sm" disabled={busy} onClick={async () => {
        setBusy(true); setError(''); setDisconnected(false);
        try { setConnections(await listChatGPTConnections(session)); }
        catch { setError('Couldn’t load connections. Check your connection and try again.'); }
        finally { setBusy(false); }
      }}>{busy ? 'Working…' : connections === null ? 'Manage connections' : 'Refresh connections'}</button>
      {connections !== null && (
        connections.length === 0 ? <p className="settings__hint" role="status">{disconnected ? 'Disconnected. ChatGPT no longer has access to your shows.' : 'No active ChatGPT connections.'}</p> : (
          <>
            <ul className="chatgpt-settings__connections">{connections.map((connection) => (
              <li key={connection.id}><strong>{connection.clientName}</strong> — {connection.scope.split(' ').includes('shows:write') ? 'Read and edit shows' : 'Read shows'}</li>
            ))}</ul>
            <button className="btn btn--danger btn--sm" disabled={busy} onClick={async () => {
              setBusy(true); setError('');
              try { await disconnectChatGPT(session); setConnections([]); setDisconnected(true); }
              catch { setError('Couldn’t disconnect. Access has not been revoked. Try again.'); }
              finally { setBusy(false); }
            }}>Disconnect ChatGPT</button>
          </>
        )
      )}
      {error && <p className="settings__sweep-error" role="alert">{error}</p>}
    </section>
  );
}
