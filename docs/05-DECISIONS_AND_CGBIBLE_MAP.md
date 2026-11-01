# Decisions + How This Maps onto CG Bible

*Updated 2026-11-01 after Mike's answers. This doc takes precedence over the Architecture Proposal where they disagree.*

## Decisions (Mike, 2026-11-01)

1. **Toasty runs on ChatGPT.** See "Who does what" below.
2. **Fill level has a manual input.** The scanner can always type or slide a **percentage**, e.g. for opaque bottles where the AI can tell what the bottle is but can't see the liquid. The AI's estimate pre-fills the value whenever it has one.
3. **Back Bar data comes from the live CG Bible as a read-only copy.** This is the same mechanism CG Bible's own test site uses: `GET /api/content-export` with `X-Export-Key`. That key is read-only, so this prototype can never change live data. *(Built: `src/cgbible.js`. It syncs on start and every 6 hours, and a "Sync now" button forces a refresh.)*
4. **Pricing uses a markup multiplier**, adjustable to the decimal (4×, 4.5×, 4.25×…). *(Built: `src/pricing.js`, `/pricing.html`.)*
   - Before anything goes to Toast, a person sees: **name, cost per bottle, cost per oz, the generated 1 oz / 1.5 oz highball / 2 oz prices, and the resulting × markup for each.** They can edit any price (the markup recalculates as they type), then approve.
   - Defaults match CG Bible today: **4×, $6 minimum 1 oz, rounded up to the dollar**. Rounding step and minimum are settings.
   - One deliberate difference: CG Bible today prices highball and 2 oz from the *rounded* 1 oz price (`ceil(1oz × 1.5)`). Here every pour is priced from **cost**, so the multiplier holds for every pour size. **@mike: confirm which you prefer.**

## Who does what: the agents

ChatGPT can't be embedded into our web app to watch a live camera feed: there's no way to stream the phone's camera into a ChatGPT conversation. So the work splits by what each agent is good at:

| Job | Who | How |
|---|---|---|
| **Live scan:** identify the bottle, read the fill level, talk to the scanner on screen | **The app's built-in vision AI**, called by our server through a model API. We can give it Toasty's name and personality so it feels like Toasty. CG Bible already uses the Anthropic SDK, so Claude is the natural fit; the OpenAI API would also work. | Phone sends a sharp still → server → vision model → match chips + fill % back to the phone |
| **Debrief work:** look up new bottles online, write guest descriptions and training content, check **Fintech** invoices, check **Provi** prices, enter items in the **Toast** dashboard | **Toasty (ChatGPT agent mode)**. These sites have no public APIs for this, and logging in through a browser is exactly what ChatGPT's agent mode does well. Toasty already works this way with CG Bible's agent portal (`/api/agent`). | Toasty reads a work queue page here, does the research, submits results; a human approves in the debrief |
| **Building the app, hourly board checks, schema work** | **Claude** | This repo + the board |

**Hourly check-ins.** Claude checks the board on a schedule. ChatGPT can't reliably wake itself up every hour to browse a site, so in practice Toasty checks in when Mike opens it and says "check the Inventory Scan board." `/api/board.md` gives Toasty the whole board as one readable page.

## Building on what CG Bible already has

The CG Bible repo already has most of the data model this project needs. **The prototype reuses its tables and field names exactly**, so moving it into CG Bible later means adding features, not migrating data.

| Our concept | CG Bible table (already exists) | Notes |
|---|---|---|
| Bottle | `bb_products` + `bb_size_variants` | Size, cost (`wholesale_cost`) and `on_hand_count` live per size variant |
| Ingredient Library link | `ingredients.bb_product_id` | Kept in sync by `services/bottle-links.js` |
| Learn About a Bottle link | `spirit_library_entries.bb_product_id` / `bb_products.spirit_library_entry_id` | A **permanent 86 already removes it from training rotation** (DB trigger `trg_bb_status_training`), but it stays searchable, exactly as Mike described |
| Inventory session | `bb_inventories` | |
| Multi-person counting by zone | `bb_section_claims` (one person claims a section) | |
| A counted bottle | `bb_count_entries` (`full_bottles`, `partials` JSON, `total_count`) | We add the photo, AI guess and confidence per entry |
| Unknown bottle found while scanning | `bb_pending_reconciliations` (has `photo_path`, counts, resolution) | This is the debrief's "New bottles found" list |
| New-product import | `bb_onboarding_drafts` (`source` already includes **`fintech`** and **`unknown_bottle`**; stages draft → ai_generated → admin_review → approved → synced) + `bb_onboarding_variants` | Debrief workflow 1 |
| Pour prices | `bb_pricing` (`cost_per_oz`, `price_1oz`, `price_highball`, `price_2oz`, `pending_approval`, `approved_by`) | |
| Cost history | `bb_price_history` (`source`: fintech / provi / manual) | |
| Toast changes waiting for approval | `bb_pos_queue` (`add`, `update_price`, `remove`; pending → approved → synced) | Debrief workflow 2 |
| Toast item list | `bb_toast_items` (from Toast CSV) | Reconciliation audit (mode 2) |
| Missing / 86 decisions | `bb_86_reports` (`reorder`, `restocked`, `permanent`, `dismissed`) | Debrief part B |

So what's genuinely new is: **the camera scan screen, the vision AI, the debrief screen that drives these existing tables, the pricing review, and the agent work queue.**

## Next build steps
1. ✅ Read-only Back Bar mirror + pour price calculator + approval screen.
2. **Scan screen v1:** camera, steady-frame capture, vision match chips, fill % (AI-filled, manual slider/number always available), full-bottle + / – stepper, unknown → queue. Needs an `ANTHROPIC_API_KEY` (or OpenAI key) on Railway.
3. **Debrief v1:** new bottles (Toasty's online match → confirm → pricing review → onboarding draft), missing / 86 decisions.
4. **Toasty work queue:** pages listing what needs researching or pricing, plus a form to submit results.
5. Reconciliation audit (Toast CSV ↔ Back Bar ↔ training), then the weekly Fintech scan.
