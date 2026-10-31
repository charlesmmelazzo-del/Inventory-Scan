# Industry Research — Bar Inventory Apps

*First pass by Claude, 2026-10-31. Toasty: please add, correct, and challenge.*

**Limits of this pass.** These products are closed source, so we can't read their code. This pass relies on public listings, vendor pages, and vendor-written comparisons (biased; treat as marketing). Next step is hands-on: create free accounts or watch the demo videos of ExactPour and Backbar to study the actual count screens.

## Summary table

| Product | How partial bottles are counted | Bottle identification | POS tie-in | Notable |
|---|---|---|---|---|
| **ExactPour** | Fill level captured during scan | Barcode scan | Reconciles against **Toast** & Square sales; "daily action briefs" | Free tier (1 location, 50 scans/wk). Closest to our "debrief" idea |
| **Partender** | **Visual "tenthing"**: tap the liquid line on a picture of that bottle | Pick from list / search | Yes | Invented tenthing; very fast, but it's a human eyeball estimate |
| **WISK** | **Bluetooth scale** (weigh the bottle) | Barcode scanner + scale | Yes | Most accurate partials, but needs hardware and is slower per bottle |
| **Nectar** | Ultrasound smart caps; software-only "PrecisionAudit" = tap the level on a bottle photo | Manual | Yes | Hardware heavy |
| **BinWise** | Bottle-level tracking | Barcode | POS sync | Strong for wine programs; heavier setup |
| **Backbar** (SevenFifty) | Speed-optimized counting flow | List/search | Yes | Free-forever plan. *Not the same as the CG Bible "Back Bar" mode.* |
| **Sculpture Hospitality** | Weighing + franchise auditors | — | Yes | Service model, not just software |
| **BarBee** (small vendor) | **Fixed overhead cameras + AI** estimate levels | Vision AI (claims >95% after brand fine-tune) | Planned | Closest to our camera-AI idea; claims ±3% on *transparent* bottles (unverified) |

## What to borrow

1. **Tenths as the unit for partial bottles** (Partender). It's the industry-standard way to record a partial bottle, everyone understands it, and it's a realistic precision target for a vision model. Store the raw % too.
2. **Tap-to-correct the level** (Partender/Nectar). When the AI's fill line looks wrong, the scanner taps the right spot on the frozen photo. One tap, no typing.
3. **Count shelf by shelf, in a fixed order** (Backbar, WISK). Counting the bar in the same order every time keeps counts fast. Remember each bottle's shelf location so the next count can say "next up: top shelf left, usually 14 bottles here."
4. **Daily action brief tied to Toast sales** (ExactPour). This matches our debrief. Later: expected usage (Toast sales × recipe pour sizes) vs. actual change in counts = variance/shrink.
5. **Reference photo per product** (Partender). Every confirmed scan saves the photo as a reference for that bottle, so recognition improves with each count.
6. **Scales are optional** (WISK). Keep the data model able to accept a weight later, for opaque bottles.

## Where we can beat them

- **No barcode and no typing.** Every leader still needs barcode scans or tapping through lists. Our flow is: aim the camera, then confirm.
- **An agent does the work after the count.** None of them write training content, research products online, look up invoice pricing in Fintech/Provi, or publish to Toast. We do all of that after one human confirmation.
- **One system of record.** The count, cost, pour prices, Toast menu, and training stay in sync.

## Known hard problems (to discuss)

- **Opaque or dark bottles** (e.g. stoneware, black glass, some amari): a camera can't see the liquid line. Fallback options: tap-to-estimate, weigh on a scale, or a "full / not full" toggle only.
- **Bottles behind other bottles, glare, low bar lighting.** We'll need the "hold steady" step and possibly the phone flashlight.
- **Same label, different size** (750 ml vs 1 L): pricing depends on getting this right. The model has to read the size, and the confirm step must show it.
- **Many full backups in storage**: scanning one bottle and tapping "+ count" is faster than scanning each one.

## Sources
- ExactPour listings: [GetApp](https://www.getapp.com/all-software/a/exactpour/), [SourceForge](https://sourceforge.net/software/product/ExactPour/), [Capterra](https://www.capterra.ca/software/1109032/ExactPour)
- [Backbar vs WISK (Backbar)](https://www.getbackbar.com/backbar-vs-wisk), [Backbar review](https://makerstack.co/reviews/backbar-review/)
- [WISK vs Partender (WISK)](https://wisk.ai/vs/wisk-vs-partender), [Partender vs BevSpot (WISK)](https://www.wisk.ai/blog/partender-vs-bevspot-wisk-bar-inventory)
- [7 best bar inventory apps 2026](https://pouriq-website-drew.pages.dev/blog/best-bar-inventory-apps-2026/)
- Nectar: [TechCrunch](https://techcrunch.com/2019/05/22/nectar-bar-inventory/), [Restaurant Technology News](https://restauranttechnologynews.com/2019/05/nectar-introduces-connected-beer-cap-bar-management-innovations/)
- [BarBee](https://barbee.pages.dev/en/)
- Toast Stock API (86 / stock counts): [overview](https://doc.toasttab.com/doc/devguide/apiStock.html), [OpenAPI](https://doc.toasttab.com/openapi/stock/overview/)
- Fintech invoice data: [Business Wire](https://www.businesswire.com/news/home/20240313694270/en/Fintech-Expands-Retail-Product-Portfolio-and-Strengthens-Position-in-Beverage-Alcohol-Market-Through-Asset-Acquisition-of-iControl)
