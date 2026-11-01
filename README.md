# Velora Jewellery — Node.js, Express & SQLite

Your existing Velora design and all 25 jewellery images/products are retained. The original demonstration cart and login have been replaced with a working database-backed shopping flow.

## Start on Windows

1. Install **Node.js 24.x** (includes npm). This project uses Node's built-in `node:sqlite` library. Use version 24 for the tested environment.
2. Extract the ZIP completely.
3. Open the `velora_website` folder in VS Code, then open its terminal.
4. Run:

```powershell
npm install
npm start
```

5. Open **http://localhost:3000** in your browser.
6. Keep the terminal running while using the website. Press **Ctrl+C** to stop.

Alternatively, after installing Node.js, double-click `START_WINDOWS.bat`. It installs dependencies on first use and starts the server.

**Do not open index.html directly or use VS Code Live Server for this version.** Express serves both the website and API on the same address. You do not need XAMPP, Apache, MySQL, Oracle, a SQLite server, Python, or a separate database installation. Internet access is required for the initial npm installation; the application and included images then run locally.

Check your Node version with `node --version`. The SQLite API may print an experimental warning on some Node 24 releases; this is not a failed database connection.

## Try the complete shopping flow

1. Open Jewellery. Search, filter by category, or sort by price/name.
2. Add a product to your cart. Guest carts are stored in SQLite and linked to a browser session.
3. Open Cart. Change quantities or remove items.
4. Proceed to Checkout. Sign in or create an account; your guest cart is merged with your account cart, within stock limits.
5. Enter your name, phone, street address, city and six-digit Indian PIN code.
6. Place your order using **Cash on delivery**.
7. View the order receipt. Click **Print / Save as PDF**, then choose your browser's PDF destination.
8. Open **My Orders** to revisit receipts or cancel a placed order.
9. Log out and sign in again. The account's cart and order history remain available.

No demo password or pre-created account is included. Register your own account. Sessions expire after seven days; account data remains saved. Clearing browser cookies removes access to that guest session, but signed-in data returns when you sign in again. The previous project's localStorage-only carts are not imported.

## Included improvements

- Real registration, login and logout, with salted scrypt password hashes.
- HttpOnly session cookies and SQLite-backed sessions.
- Database-driven catalogue, search, category filters and sorting.
- Persistent guest and account carts with quantity controls and a cart counter.
- Validated delivery form and cash-on-delivery checkout.
- Server-side pricing: prices and totals submitted by a browser are never trusted.
- Transactions for order creation, stock reduction and cart clearing.
- Retry protection: a repeated checkout reference returns the same order.
- Order history restricted to the signed-in customer.
- Permanent item and price snapshots in each order.
- Printable receipts with order number, delivery details, item quantities and totals.
- Cancellation with stock restoration, without deleting order history.
- Contact messages saved in SQLite; this does not send email.
- Mobile navigation, empty states and visible error messages.
- Parameterized queries, input validation, write-request protection and basic rate limits.

## Database and project layout

```text
velora_website/
  server.js             Express server, API routes and database logic
  schema.sql            Table definitions, constraints and indexes
  products.json         Initial 25-product catalogue; 25 units per product
  package.json          Start/test commands and dependencies
  package-lock.json     Dependency versions for reproducible installation
  START_WINDOWS.bat     Windows launcher
  data/
    velora.db           Automatically created on the first server start
  public/
    index.html          Home
    jewellery.html      Searchable product catalogue
    cart.html           Cart
    login.html          Login
    register.html       Registration
    checkout.html       Delivery and order placement
    orders.html         Order history and cancellation
    receipt.html        Printable order receipt
    collection.html     Collections
    about.html          About
    contact.html        Contact form
    css/style.css       Existing design plus shopping-flow styles
    js/script.js        Browser/API integration
    Image/              Your original images
  test/shop.test.js     Automated integration tests
```

| Table | Stored information |
| --- | --- |
| users | Name, unique email and password hash |
| sessions | Hashed session token, optional user ID and expiry |
| products | Name, category, price in paise, image path and stock |
| cart_items | Guest/account owner, product ID and quantity |
| orders | Customer, delivery details, totals, status and checkout key |
| order_items | Permanent product name/price/quantity snapshot per order |
| contact_messages | Name, email, subject, message and timestamp |

Money is stored as integer **paise** to avoid floating-point rounding errors. ₹2,999 is stored as 299900. Dates are saved in UTC and displayed in the browser's local time. Shipping is free. No separate tax calculation is implemented.

The SQLite file is on the computer running Node, not on each visitor's computer. All clients of that running server use the same database. Each authenticated customer's cart and orders are isolated by user ID.

To inspect data, open `data/velora.db` using a SQLite-compatible database viewer. Example read-only queries:

```sql
SELECT id, name, email, created_at FROM users;
SELECT id, name, price_paise / 100.0 AS price_rupees, stock FROM products;
SELECT id, user_id, customer_name, total_paise / 100.0 AS total_rupees,
       status, payment_status, created_at FROM orders;
SELECT order_id, name, quantity, unit_price_paise / 100.0 AS unit_price_rupees
FROM order_items;
SELECT name, email, subject, message, created_at FROM contact_messages;
```

`schema.sql` creates missing tables automatically. `products.json` seeds missing product IDs on startup; it does not overwrite prices or stock already in the database. Do not edit prices in HTML: the API renders the authoritative database prices.

## Backups

Stop the server with Ctrl+C before copying the entire `data` folder somewhere safe. Restore by stopping the server and replacing the folder with your backup. SQLite may also create `velora.db-wal` and `velora.db-shm` while it runs; do not copy only the main file while a server is actively writing. Keep backups private because they contain customer details.

## Tests

```powershell
npm test
```

The 13 tests create an isolated temporary database and remove it afterwards. They never overwrite `data/velora.db`. They cover persistence, authentication, guest cart merging, private order access, stock validation, transactional checkout, duplicate checkout retries, cancellation, contact submission and overselling prevention.

Page-script integration was also checked in a DOM environment against the real Express API, covering filters, cart quantities, registration, checkout, receipt rendering, cancellation and contact submission. Full Chromium visual testing could not run because the execution environment blocked browser launch.

## Optional configuration

Default: `HOST=127.0.0.1`, `PORT=3000`, database at `data/velora.db`.

If port 3000 is busy, in PowerShell:

```powershell
$env:PORT = "3001"
npm start
```

Then open http://localhost:3001. In Windows Command Prompt, use `set PORT=3001` instead.

For a trusted local-network demonstration, bind to the network interfaces:

```powershell
$env:HOST = "0.0.0.0"
npm start
```

Allow Node through Windows Firewall for the private network, and have other devices open `http://YOUR-PC-LAN-IP:3000`. The server computer must remain running. For public hosting, use a Node host with persistent disk storage, HTTPS, and `NODE_ENV=production` so session cookies are secure. Do not place this SQLite database on an ephemeral hosting filesystem.

## Scope

This is a working local project, not a connected fulfilment or payment service. Cash-on-delivery orders are recorded as **Unpaid**. Receipts are order confirmations, not payment receipts or GST tax invoices. No money is charged, no courier is contacted, and no email is sent. There is no admin dashboard, payment gateway, email verification, password recovery, or automatic delivery tracking. These require separate implementation before running a real public store. The boutique address and contact text are retained from the original site; verify them before publishing.

Use one Node process with this SQLite file. The synchronous SQLite implementation is suitable for a local college project and modest demos; larger deployments need a separate scalability review.

## References

- Node SQLite documentation: https://nodejs.org/docs/latest-v24.x/api/sqlite.html
- Express API: https://expressjs.com/en/5x/api/
