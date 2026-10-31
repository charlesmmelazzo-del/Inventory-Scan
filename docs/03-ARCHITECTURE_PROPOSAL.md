# Architecture Proposal (draft v0, for discussion)

*Claude's first proposal. Toasty, mark up anything you disagree with on the board (topic `scan-flow`, `data-model`, etc.).*

## 1. Camera → AI: how the feed gets to the agent

**No third-party streaming service is needed for v1.** The browser can do this on its own:

```
Phone browser (CG Bible web app)
  getUserMedia({ video: { facingMode: 'environment' } })   ← rear camera, needs HTTPS (Railway gives us that)
  │
  ├─ ON-DEVICE, every frame (instant, free):
  │    • sharpness / motion check  → "hold steady" vs "OK"
  │    • is there a bottle-shaped object in the center? → green / move hints
  │
  └─ When steady + sharp: grab ONE high-res still (JPEG ~150–300 KB)
       → WebSocket → our server  → vision model (Claude) with:
            - the photo
            - top-N Back Bar candidates (from label text / recent shelf context)
            - reference photos for those candidates (if we have them)
       ← { candidates[], confidence, size_ml, fill_tenths, is_sealed, notes }
       → phone shows the confirm card
```

Why stills instead of continuous video to the model:
- Video is just many stills. The model reads one sharp still more accurately than a blurry moving frame.
- It's cheaper and faster. The steadiness check on the phone gives the instant "move left / stop" feedback, and the model only sees the frames worth reading.
- It works on bar Wi-Fi and LTE.

**Live talk-back from the agent.** The server keeps a **scan-session event stream** (WebSocket). Every frame result, confirmation, and correction is an event. An agent like Toasty connects to the same session and can:
- read events and photos as they happen,
- push messages to the scanner's screen ("That's the 1 L, not the 750"; "You skipped the bottom shelf"),
- answer questions.

**Later:** optional voice using a realtime speech API, so the scanner can say "yes" / "next" hands-free.

## 2. Matching a bottle to Back Bar

1. The vision model reads the label: brand, expression, age statement, size, ABV.
2. The server fuzzy-matches that text against the Back Bar catalog. Two cheap filters narrow the list: the bottle's usual shelf, and items already counted this session.
3. The scanner gets the top 3 as **confirm chips**. Tapping one = confirmed.
4. **Each confirmed photo is saved as a reference image for that bottle**, so the next count recognizes it faster and more accurately.
5. No good match → search box → full Back Bar list by category → **Add New** (goes to the unknown queue with the photo and count).

## 3. Fill level

- Record **tenths** (0.0–1.0 of a bottle; industry standard) plus the model's raw % estimate and confidence.
- **Sealed / full bottles:** "Full ×1" with a **+ / –** stepper for backups of the same product, so the scanner doesn't have to scan each one.
- **Low confidence or opaque bottle:** show the frozen photo with the model's fill line drawn on it. The scanner taps to move the line. One tap, no typing.
- Volume on hand = full_count × size + Σ(partial tenths × size).

## 4. Data model (prototype; mirrors CG Bible fields so the merge is easy)

```
inventory_session   id, name, started_by, status(open|counting|debrief|closed), started_at, closed_at
session_member      session_id, user, zone
scan_event          id, session_id, user, zone, photo_url, model_output(json), bottle_id?, unknown_id?,
                    full_count, partial_tenths, confirmed(bool), created_at
bottle              id, name, producer, category, size_ml, abv, cgb_backbar_id, cgb_ingredient_id,
                    toast_item_guid, training_doc_id, status(active|reorder|86_temp|86_perm),
                    cost_bottle, cost_oz, price_1oz, price_1_5oz, price_2oz, ref_photos[]
unknown_item        id, session_id, photos[], qty, proposed_match(json), status(pending|confirmed|rejected)
price_quote         bottle_id|unknown_id, source(fintech|provi|manual), size_ml, unit_cost, invoice_ref, found_at
pricing_settings    markup_mode(multiplier|pour_cost_pct), markup_value, rounding(0.25|0.50|1.00)
debrief_action      id, session_id, kind(new|missing|reconcile|fintech), target, decision, done_at, log(json)
```

## 5. Pour price calculator

```
oz_in_bottle = size_ml / 29.5735
cost_per_oz  = bottle_cost / oz_in_bottle
price(pour)  = round_up( cost_per_oz × pour_oz × multiplier , rounding )      # multiplier mode
          or = round_up( cost_per_oz × pour_oz / target_pour_cost_pct , rounding)  # pour-cost mode
pours: 1.0 oz, 1.5 oz (highball), 2.0 oz
```
Example: $32 750 ml → 25.36 oz → $1.26/oz. At a 20% pour cost: 1 oz $6.31 → **$6.50**, 1.5 oz → **$9.50**, 2 oz → **$12.75** (rounded up to $0.25).

## 6. Integrations: what we know so far

| System | What we need | What exists | Plan |
|---|---|---|---|
| **Toast** | 86 / un-86; create spirit items with prices + descriptions; archive | Official **Stock API** can set items out of stock (`stock:write`). Menu **create/price edit via API is not confirmed** (Menus API looks read-only) | Use the Stock API for 86. For menu writes: (a) check whether our Toast account can get menu write access, else (b) have the agent use the Toast web dashboard. **Toasty: what access do you have today?** |
| **Fintech** | Invoice line items (product, size, unit cost, date) | Retailer portal with ~15 months of invoices; Fintech also offers daily electronic files (CSV/EDI) to retailers | Prefer the daily file/CSV export. Fallback: the agent logs into the portal |
| **Provi** | Price for a product + size | No public API found | Agent logs in and searches |
| **CG Bible** | Back Bar, Ingredient Library, Learn About a Bottle | Exists already | **Need repo/API access** to mirror the schema and sync |
| **Web product data** | Description, producer info, image | — | Agent web search + write; human confirms in the debrief |

## 7. Build order (proposed)

1. ✅ Message board + shared docs (this).
2. Back Bar import: load the current CG Bible bottle list into the prototype (CSV export or API).
3. Scan screen v1: camera, steadiness check, still capture, model ID + confirm chips, fill tenths, full-count stepper, unknown queue. Multi-user sessions.
4. Debrief v1: new bottles (web match + confirm), missing/86 decisions.
5. Pour price calculator + Fintech/Provi lookup (manual entry first, automate after).
6. Toast reconciliation audit (read-only diff first, then write actions).
7. Fintech weekly scan.
8. Agent live channel (Toasty on the scan event stream).
9. Field test at the bar → fix → integrate into CG Bible.

## 8. Open questions for Mike
1. What is Toasty running on (which platform/model), and can it receive images or open a WebSocket? This decides how it joins live scans.
2. Can we get read access to the CG Bible app repo or database, or a Back Bar CSV export?
3. Toast: what API access does the account have (Stock API? Menus? partner credentials)?
4. Fintech: is a daily CSV/EDI invoice file already set up, or is it portal login only?
5. Markup: a multiplier (e.g. 5×) or a target pour cost % (e.g. 20%)? What rounding ($0.25 / $0.50 / $1)?
