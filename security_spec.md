# Firestore Security Architecture Specification — Siranchowk Khaja Ghar

## 1. Core Data Invariants
1. **Global Default-Deny**: Any unmatched path under `/databases/{database}/documents` is unconditionally denied (`allow read, write: if false`).
2. **Verified Identity**: All customer writes require `request.auth != null` and `request.auth.token.email_verified == true`.
3. **Bootstrapped Admin With Email Spoof Guard**: `isAdmin()` checks `exists(/databases/$(database)/documents/admins/$(request.auth.uid))` OR (`request.auth.token.email == 'minecraftboot411@gmail.com' && request.auth.token.email_verified == true`). Unverified emails never elevate privileges.
4. **Master Gate Relational Sync**: `/chatSessions/{sessionId}/messages/{messageId}` messages cannot be read via `get` or created unless `/chatSessions/{sessionId}` exists, `ownerId == request.auth.uid`, and on `create`, `status == 'active'` plus atomic batch increment (`getAfter(...).messageCount == get(...).messageCount + 1`).
5. **Terminal State Locking**: Archived chat sessions (`status == 'archived'`) cannot be modified by standard users (only `isAdmin()` override).
6. **Temporal Integrity & Immutability**: `createdAt == request.time` on `create`; `updatedAt == request.time` on `update`; `ownerId`/`userId`/`uid`/`sessionId`/`placeId`/`createdAt` are immutable on `update`.
7. **Query Enforcement**: Every `allow list` rule evaluates `resource.data` directly (`ownerId == request.auth.uid` or `userId == request.auth.uid`) without calling `get()`/`exists()` inside `allow list`.

## 2. The "Dirty Dozen" Adversarial Payloads (All Expected: PERMISSION_DENIED)
1. **Unauthenticated Write**: `POST chatSessions/sess_1` with `auth = null`.
2. **Unverified Email Write**: `CREATE savedPlaces/place_1` with `email_verified = false`.
3. **Admin Email Spoof**: `READ admins/otherUid` with `email = 'minecraftboot411@gmail.com'` and `email_verified = false`.
4. **Identity Spoofing on Create**: `CREATE chatSessions/sess_2` where `ownerId = 'victim_uid'` != `request.auth.uid`.
5. **ID Poisoning**: `CREATE savedPlaces/bad.id$1500...` exceeding 128 chars or non-`[a-zA-Z0-9_-]`.
6. **Ghost / Shadow Field Injection**: `CREATE userPreferences/uid1` including `role: 'admin'` or `isAdmin: true`.
7. **Timestamp Forgery**: `CREATE chatSessions/sess_3` with client `createdAt: Timestamp(2020-01-01)` instead of `request.time`.
8. **Orphan Message Write**: `CREATE chatSessions/nonexistent/messages/msg_1` without a parent session.
9. **Non-Atomic Message Write (Bypassing messageCount)**: `CREATE chatSessions/sess_1/messages/msg_2` without incrementing parent `chatSessions/sess_1.messageCount`.
10. **Terminal State Bypass**: `UPDATE chatSessions/archived_sess` trying to flip `status: 'archived'` back to `'active'` or rename `title`.
11. **Array & String Poisoning**: `CREATE chatSessions/sess_1/messages/msg_3` with `groundingUrls: ['https://a', ... 11 items]` or `text` > 4000 chars.
12. **Blanket List Scraping**: `LIST /chatSessions` or `LIST /savedPlaces` without `.where('ownerId' / 'userId', '==', auth.uid)`.
