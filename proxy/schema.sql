-- The Worker's shared store of Josekipedia nodes (see cloudflare-worker.js).
-- Apply with:  npx wrangler d1 execute joseki-nodes --remote --file schema.sql
CREATE TABLE IF NOT EXISTS nodes (
    id INTEGER PRIMARY KEY,   -- Josekipedia's node id
    body TEXT NOT NULL,       -- The node's JSON, exactly as Josekipedia sent it
    fetched INTEGER NOT NULL  -- When it was fetched (seconds since 1970), so old nodes are refreshed
);
