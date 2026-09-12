/**
 * BIN-1163 — tell this browser's OTHER tabs that my identity fields changed.
 *
 * `firestore.rules`' `isOwnIdentity` compares the `displayName`/`username` a write
 * carries against the LIVE value in `users/{uid}`. Every writer sends the copy
 * `AuthContext` holds in memory, and that copy was loaded once per auth event. So
 * after BIN-1154 made the display name editable, a rename in one tab left every
 * other open tab writing a name the rule no longer recognises — its reviews,
 * comments, episode reactions, friend requests and group invites were all DENIED
 * until it reloaded. The guard was built against forgery (BIN-1126) and had started
 * failing ordinary use.
 *
 * WHY `BroadcastChannel` AND NOT A `localStorage` KEY. Malin's decision, 2026-09-11:
 * "a pure event, not a state meant to survive". ADR 0019 and BIN-748 both record the
 * same trap from opposite ends — a flag written to `localStorage` has no honest
 * moment of retirement, so it can never be safely cleared, and BIN-817 records what
 * it costs when the thing left behind is profile fields in plaintext with no expiry.
 * A `BroadcastChannel` message exists only in flight: nothing is written to disk, so
 * there is nothing to retire and nothing to erase on deletion.
 *
 * NO PRIVACY-POLICY ENTRY IS NEEDED, and the reason is written here so the next
 * reviewer does not have to re-derive it (#5 Legal/GDPR, blind critique 2026-09-12):
 * the payload is the user's own two identity fields, moving between same-origin tabs
 * of one browser, in memory, never leaving the device and never stored. It is never
 * an authority source either — `isOwnIdentity` always re-reads the live document, so
 * a message can only make a tab's own subsequent write SUCCEED, never let it claim
 * an identity the server would not have accepted. That is neither a new processing
 * purpose nor a new recipient.
 *
 * THE PAYLOAD IS CLOSED ON PURPOSE. Exactly `uid`, `displayName`, `username` — the
 * two fields `isOwnIdentity` binds, plus the uid the receiver checks them against.
 * `parseProfileIdentityMessage` rejects a message with any other key rather than
 * ignoring the extra, so adding a third field is a deliberate decision instead of
 * something that slips through an already-open pipe (#4, #5, #6, independently).
 */

export const PROFILE_IDENTITY_CHANNEL = 'binge:profile-identity';

export interface ProfileIdentityMessage {
  /** The account the fields belong to. The receiver compares this against its own. */
  uid: string;
  displayName: string;
  username: string | null;
}

/** The complete key set. A message with more or fewer keys is refused, not trimmed. */
const MESSAGE_KEYS = ['uid', 'displayName', 'username'] as const;

/**
 * Returns the message only if it is exactly the shape above. `null` for anything
 * else — a foreign channel name collision, a future build posting a wider payload,
 * or a hand-crafted message from another script on the origin.
 */
export function parseProfileIdentityMessage(raw: unknown): ProfileIdentityMessage | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const keys = Object.keys(raw as Record<string, unknown>);
  if (keys.length !== MESSAGE_KEYS.length) return null;
  if (!MESSAGE_KEYS.every(k => keys.includes(k))) return null;
  const { uid, displayName, username } = raw as Record<string, unknown>;
  if (typeof uid !== 'string' || uid === '') return null;
  if (typeof displayName !== 'string') return null;
  if (username !== null && typeof username !== 'string') return null;
  return { uid, displayName, username };
}

export interface ProfileIdentityChannel {
  post(message: ProfileIdentityMessage): void;
  close(): void;
}

const NOOP_CHANNEL: ProfileIdentityChannel = { post: () => {}, close: () => {} };

/**
 * Open one channel used for BOTH sending and receiving. A `BroadcastChannel` never
 * delivers to the object that posted, so a single instance per tab is what makes a
 * tab ignore its own message without any echo-suppression logic.
 *
 * Returns an inert handle where the API is missing or construction throws (an older
 * browser, a hardened profile). The pre-BIN-1163 behaviour is then unchanged: the
 * other tab stays stale until it reloads, which it already did and which is
 * self-healing — a degraded sync must never be a broken app.
 */
export function openProfileIdentityChannel(
  onMessage: (message: ProfileIdentityMessage) => void,
): ProfileIdentityChannel {
  if (typeof window === 'undefined') return NOOP_CHANNEL;
  const Ctor = (window as { BroadcastChannel?: typeof BroadcastChannel }).BroadcastChannel;
  if (typeof Ctor !== 'function') return NOOP_CHANNEL;

  let channel: BroadcastChannel;
  try {
    channel = new Ctor(PROFILE_IDENTITY_CHANNEL);
  } catch {
    return NOOP_CHANNEL;
  }

  const handler = (event: MessageEvent) => {
    const parsed = parseProfileIdentityMessage(event.data);
    if (parsed) onMessage(parsed);
  };
  channel.addEventListener('message', handler);

  return {
    post: message => {
      try {
        channel.postMessage(message);
      } catch {
        // A closed or errored channel must not fail the rename that triggered it.
      }
    },
    close: () => {
      channel.removeEventListener('message', handler);
      try {
        channel.close();
      } catch {
        /* already closed */
      }
    },
  };
}
