import { FieldValue, type Firestore } from 'firebase-admin/firestore';

/**
 * An inbox card under a deterministic id, written with create(): a retry after a
 * crash finds it and leaves it alone, so it is never doubled and a card the user
 * already read is never marked unread again. Returns false when it existed.
 */
export async function createInboxCard(
  db: Firestore,
  uid: string,
  id: string,
  card: { title: string; body: string },
): Promise<boolean> {
  try {
    await db.collection('users').doc(uid).collection('notifications').doc(id).create({
      kind: 'system',
      title: card.title,
      body: card.body,
      actionUrl: '/savings/',
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    });
    return true;
  } catch (err) {
    if ((err as { code?: unknown }).code === 6) return false; // ALREADY_EXISTS
    throw err;
  }
}
