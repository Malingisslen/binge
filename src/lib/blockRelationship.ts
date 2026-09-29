// BIN-1349: dokumenten en blockering raderar, som sökvägssegment. Både
// `blockUserAndEndFriendship` och emulatortestet i src/test/rules läser listan härifrån,
// så testet prövar reglerna mot exakt de vägar appen skriver.
export function relationshipDocsToClear(myUid: string, targetUid: string): string[][] {
  return [
    ['users', myUid, 'friends', targetUid],
    ['users', targetUid, 'friends', myUid],
    ['users', myUid, 'friendRequests', targetUid],
    ['users', targetUid, 'friendRequestsSent', myUid],
    ['users', myUid, 'friendRequestsSent', targetUid],
    ['users', targetUid, 'friendRequests', myUid],
  ];
}
