# Inventory Scan — Project Brief

*Owner: Mike (CG Cocktails). Working name "Inventory Scan" until we choose a real name.*
*This is a standalone prototype. Once it tests well it gets built into the CG Bible app.*

## The goal

Keep one reliable record of every spirit and liquor product we physically have. For every bottle on the back bar:

- **CG Bible app** has the quantity and the cost (per bottle and per ounce), linked to Back Bar and the Ingredient Library.
- **Toast POS** has the item on the spirits list with a guest-facing description and 1 oz, 1.5 oz (highball) and 2 oz pour prices.
- **Training** ("Learn About a Bottle") has content about the product and its producer.

Counts are kept accurate on a regular schedule, and later features will rely on them.

Three things feed that record:
1. **Visual scan inventory.** Count with a phone camera.
2. **Toast ↔ CG Bible reconciliation audit.**
3. **Fintech invoice scan.** Find new products from invoices.

All three end in the **Inventory Debrief**. A person confirms there, and the agent does the rest.

---

## Mode 1: Visual scan inventory (the core)

**Design rule: the person scanning only aims and confirms. No typing during the count.**

1. In the app, tap **Start Inventory**. Several people can join the same inventory, for example one per zone or shelf.
2. Tap **Start Scanning**. The phone asks to use the camera.
3. The top of the screen shows the **live camera view**, so the person knows where they're aiming.
4. Below it is a **live guidance strip**:
   - green when the framing is good, and arrows or text such as "move left" or "closer";
   - **STOP / hold steady** when it needs a clear frame to read the fill level;
   - a **confirm card** when it finds a match: "Is this *Buffalo Trace 750 ml*?" with **Yes**, the 2–3 next-best matches, and **Not it**.
5. After a match is confirmed, it estimates **how full** the bottle is and records it. Full sealed bottles are counted as full units, and partial bottles get a fill level (in tenths or a %).
6. **If there's no match:**
   - a search box over Back Bar;
   - if search finds nothing, the full Back Bar list **sorted by category**;
   - if it isn't there either, tap **Add New**. The photo and quantity are logged to the **unknown queue** for the debrief. Nothing more is entered right then.
7. Finish. The scan log (photos, matches, counts and fill levels) becomes a debrief.

## Inventory Debrief (in the portal)

### A. New bottles found
Bottles that were scanned, didn't match, and were marked "add this".
- The agent reviews the photos and quantities and **finds the product online**: label, producer, **bottle size**.
- A person confirms: "Yes, right product, right size."
- Confirming starts **two workflows**:

**Workflow 1: add to the CG Bible app**
- Create the bottle in **Back Bar**, linked to the **Ingredient Library**, with the confirmed quantity.
- **Pricing.** Look in **Fintech** invoices first, matching both label and size. If it's not there, check **Provi**. If it's in neither, ask a person to enter the cost.
- Calculate **cost per oz** = bottle cost ÷ bottle volume in oz. Save the cost per bottle and per oz to Back Bar.
- Apply the **standard pour markup** from the **Pour Price Calculator** setting to get **1 oz, 1.5 oz (highball) and 2 oz** prices.
- **Training.** The agent writes content about the **product** and its **producer** and files it in the right sections of "Learn About a Bottle".

**Workflow 2: publish to Toast**
- Add the item to the **spirits list** with the correct name, a **description that sells it to guests**, and the 1, 1.5 and 2 oz prices.

### B. Missing / 86
Items that are in Back Bar or Toast but **weren't scanned**. For each one:
- **Found it.** Someone goes and looks, then enters the count by hand.
- **Reorder.** Keep it in the system, training and Toast, add it to the order list, and **mark it 86 in Toast** so guests can't order it until it's back.
- **Permanently 86.** Archive it from "Learn About a Bottle" so it's still searchable but no longer appears in random training, and archive it from the Toast spirits list.

## Mode 2: Toast ↔ CG Bible reconciliation audit
- Everything in Toast should also be in Back Bar and in training, and the reverse.
- List each mismatch, such as "in Toast but not in CG Bible" or "in CG Bible but not in Toast". Each gets a **fix action** a person picks: add, link to an existing item, archive, or ignore.

## Mode 3: Fintech scan (about weekly)
- A **Fintech Scan** button. The agent reads every invoice since the last inventory or scan and finds **products it doesn't know**.
- For each one, a person confirms it and enters the quantity on hand. It then goes through the same add-new flow as Workflow 1 and Workflow 2.

## Settings
- **Pour Price Calculator.** Standard markup for all spirit pours. Pour sizes are 1, 1.5 and 2 oz.

## Agentic AI (Toasty or any agent)
- During a count, the agent should **see through the camera** and **talk with the scanner live**.
- In the debrief, the agent does the research, pricing, writing and Toast publishing. Humans only confirm.
- During the prototype the agent has **full access**. Security can be tightened later.

## Process
1. Research industry leaders such as ExactPour, Partender, WISK, BinWise, Backbar, Sculpture and Nectar (see `02-INDUSTRY_RESEARCH.md`).
2. Claude and Toasty work out the design together on this message board and check it hourly.
3. Build and test the prototype here, deployed on Railway.
4. Once Mike is happy with the test results, build it into the CG Bible app and sync it with the existing Back Bar data.
