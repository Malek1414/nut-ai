-- Friend invitations store only a digest. Consuming the row and adding the pair
-- are one SQLite statement, including when two phones scan the same QR.
CREATE TABLE IF NOT EXISTS chat_invites (
  owner TEXT PRIMARY KEY, digest TEXT NOT NULL UNIQUE, expires INTEGER NOT NULL, redeemed_by TEXT
);
CREATE TABLE IF NOT EXISTS chat_friends (
  a TEXT NOT NULL, b TEXT NOT NULL, PRIMARY KEY(a,b), CHECK(a<b)
);
CREATE INDEX IF NOT EXISTS chat_friends_b ON chat_friends(b,a);
CREATE TRIGGER IF NOT EXISTS chat_friend_redeemed AFTER UPDATE OF redeemed_by ON chat_invites
WHEN OLD.redeemed_by IS NULL AND NEW.redeemed_by IS NOT NULL BEGIN
  INSERT OR IGNORE INTO chat_friends(a,b)
    VALUES(min(NEW.owner, NEW.redeemed_by),max(NEW.owner, NEW.redeemed_by));
END;
CREATE TABLE IF NOT EXISTS chat_blocks (
  actor TEXT NOT NULL, target TEXT NOT NULL, PRIMARY KEY(actor,target), CHECK(actor<>target)
);
CREATE TABLE IF NOT EXISTS chat_threads (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, created INTEGER NOT NULL,
  direct_key TEXT UNIQUE
);
CREATE TABLE IF NOT EXISTS chat_members (
  chat TEXT NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  account TEXT NOT NULL, last_read INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(chat,account)
);
CREATE INDEX IF NOT EXISTS chat_members_account ON chat_members(account,chat);
CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, chat TEXT NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  sender TEXT, kind TEXT NOT NULL, text TEXT NOT NULL, payload TEXT, created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS chat_messages_thread ON chat_messages(chat,id);
CREATE TABLE IF NOT EXISTS chat_audio (
  message INTEGER PRIMARY KEY REFERENCES chat_messages(id) ON DELETE CASCADE,
  audio BLOB NOT NULL, mime TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chat_votes (
  message INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  account TEXT NOT NULL, option_id TEXT NOT NULL, PRIMARY KEY(message,account)
);
CREATE TABLE IF NOT EXISTS chat_reports (
  id INTEGER PRIMARY KEY, actor TEXT NOT NULL, message INTEGER NOT NULL, chat TEXT NOT NULL,
  target TEXT, reason TEXT NOT NULL, created INTEGER NOT NULL, UNIQUE(actor,message)
);
