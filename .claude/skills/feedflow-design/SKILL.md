---
name: feedflow-design
description: >
  Visuelt designsprog for FeedFlow's UI. Brug denne skill HVER gang du bygger,
  ændrer eller reviewer UI/styling i FeedFlow (sider, komponenter, kort, knapper,
  lister, tabeller, navigation, tomme tilstande). Skill'en definerer typografi,
  farve, afstand, form og de principper der får appen til at føles "hævet" og
  intentionel frem for template-agtig. Konsultér ALTID reference-billederne i
  references/ før du designer, og match deres niveau. Trigger på enhver opgave der
  rører hvordan FeedFlow SER UD.
---

# FeedFlow design-system

Dette er FeedFlows visuelle designsprog. Det er destilleret fra en reference-bank
brugeren har kurateret (Datashake, Orchestra, Wavelength — se `references/`). Læs
referencerne FØR du designer, og sigt efter deres niveau.

/ Rent UI/præsentation. Rør ALDRIG funktionel logik, data, routes, ownership,
grounding eller migrationer fra en design-opgave. /

---

## Den vigtigste indsigt: hvad gør det "hævet"

Brugerens referencer er IKKE farverige. De er overvejende **neutrale og luftige**,
med farve brugt som **præcise, små accenter**. Det "hævede" niveau kommer fra fire
ting, i prioriteret rækkefølge:

1. **Stor, selvsikker typografi.** Overskrifter er store, tætte (stram line-height),
   og bærer siden. Dette er det enkeltvigtigste træk. Små forsigtige overskrifter =
   template-følelse. (Se hero_orchestra, data_foundation_section_datashake,
   power_your_data_section_datashake.)
2. **Generøs luft.** Rigeligt whitespace omkring og mellem elementer. Indhold får
   plads. Aldrig tætpakket.
3. **Farve som krydderi, ikke hovedret.** Fundamentet er neutralt (varm offwhite +
   varm næsten-sort). Farve optræder i SMÅ doser: et lille ikon-felt, en enkelt
   knap, en status-pill, en tynd accentlinje. ALDRIG store fyldte farveblokke side
   om side (det blev afprøvet og føltes for meget).
4. **Lette, tekniske detaljer.** Tynde hairline-kanter, stiplede/dottede linjer,
   fine skillelinjer. Giver et raffineret, præcist udtryk.

---

## Tokens

### Neutralt fundament (det meste af UI)
- `--bg-base: #FDFCFB;`      varm offwhite, primær baggrund
- `--bg-surface: #F4F3F0;`   dæmpede paneler/sektioner
- `--ink: #1A1A18;`          primær tekst, varm næsten-sort
- `--ink-secondary: #57564F;` brødtekst/sekundær
- `--ink-muted: #8A8980;`    labels/hints
- `--hairline: rgba(26,26,24,0.10);` fine kanter

### Mørke kontrast-sektioner (bruges bevidst og sparsomt)
- `--dark-bg: #1E1E1A;` med tekst `#FDFCFB`, dæmpet `rgba(255,255,255,0.55)`
- Bruges til: hero/kontekst-bånd, en enkelt fremhævet sektion, evt. sidepanelet.
- Det er HER farvede accentlinjer/detaljer må poppe mod det mørke (jf. Wavelength).

### Accentfarver — KUN som små detaljer (ikon-felter, pills, linjer, status)
- `--accent-purple: #7C5CFC;` (primær brand — knapper, aktivt nav, vigtige tal)
- `--accent-green: #1FB46A;`  (success/active/ok)
- `--accent-amber: #E8A317;`  (warning)
- `--accent-red: #E0524C;`    (error)
- Dekorative accenter (sparsomt, til ikon-felter/linjer): pink #F677FD, gul #FFDD03,
  orange #F9720D, mint #63F6B5 — som Wavelengths palet, men i SMÅ felter (~36–44px),
  aldrig store flader.

### Form
- Border-radius: `10px` standard (kort, knapper, inputs); `14px` på store kort.
- Kanter: `1px solid var(--hairline)` på neutrale kort. Små farve-ikon-felter må have
  en mørk `1px solid var(--ink)` kant (Wavelength-signaturen — men kun på de små felter).
- Flat. Ingen gradienter, ingen glød. Skygger kun funktionelle (focus-ring), eller
  en enkelt diskret hover-løft hvis ønsket.

---

## Typografi (kritisk — her ligger løftet)

- **Sidetitler / hero:** store og selvsikre. 28–40px, font-weight 500, line-height
  ~1.1, letter-spacing -0.02em. Tæt og rolig. (Match referencernes overskriftsvægt.)
- **Sektionstitler:** 18–22px, weight 500.
- **Brødtekst:** 15–16px, weight 400, line-height 1.6, `--ink-secondary`.
- **Labels/eyebrows:** 11–12px, uppercase, letter-spacing 0.08em, `--ink-muted`.
  (Som "INTELLIGENT OPERATIONS" / "Step 01" i referencerne.)
- **Tal (stats):** store og rolige — 24–32px weight 500, så nøgletal føles vigtige.
- To vægte: 400 og 500. Aldrig 600/700 (bliver klodset). Sentence case.
- Overvej en let serif/kursiv accent til ét fremhævet ord i en stor titel (jf.
  Orchestra) — valgfrit krydderi, ikke et krav.

---

## Afstand / layout

- Generøs vertikal rytme: 1.5–2.5rem mellem sektioner. Lad siden ånde.
- Maks indholdsbredde så linjer ikke strækker sig endeløst; centrér på brede skærme
  (undgå den store tomme højreside FeedFlow havde).
- Konsistent indre padding: 1.25–1.5rem i kort.
- Brug skillelinjer/hairlines og whitespace til at gruppere — ikke kasser-i-kasser.

---

## Sådan anvendes det på FeedFlow's flader

### Sidepanel
Mørkt (`--dark-bg`) — bevarer signatur + kontrast mod lyst indhold. Aktivt punkt:
fyldt med brand-lilla, hvid tekst. (Aktiv-tilstand matcher eksakt rute — allerede fikset.)

### Sidetitler
Hver side får en STOR, selvsikker titel (28–40px) — fx "Tysk · BWH" som et rigtigt
sidehoved, ikke en lille label. Evt. en lille uppercase eyebrow over (fx feed-status).
Dette alene løfter niveauet markant.

### Funktioner / navigation (fx på Overview)
I stedet for fire store fyldte farveblokke: rolige neutrale kort med et LILLE farvet
ikon-felt (36–44px, farve + mørk kant) øverst, en titel, et nøgletal. Farven sidder i
det lille ikon-felt — ikke i hele kortet. (Jf. Wavelengths product_feature_overview:
små farvede ikon-felter på lyse kort.)

### Data-flader (Products, Mapping, Results, Preview, lister)
Rolige og læsbare. Hvide/offwhite rækker, hairline-skillelinjer, mørk tekst. Farve KUN
til status-pills/tags (active=grøn, warning=amber, AI-optimeret=lilla) — som de farvede
tags i Wavelengths account-tabel. Aldrig farvede flader bag tæt data.

### Knapper
Primær: brand-lilla `#7C5CFC` fyldt, hvid tekst, radius 10px. Sekundær: offwhite med
hairline-kant, mørk tekst. Lille `↗`/`→` på handlinger der fører videre (jf. referencer).

### Mørke moment
Tillad ét mørkt kontekst-bånd eller én mørk sektion hvor det giver mening (fx et
sidehoved-bånd), hvor en tynd farvet accentlinje (Wavelengths "kredsløb") må optræde
diskret. Brug med måde — ikke på hver side.

### Tomme tilstande
Lav dem intentionelle: en kort rolig linje + evt. et dæmpet ikon, masser af luft.
Ikke en bar "ingen data"-streng.

---

## Tjekliste før du afslutter en flade
- [ ] Er sidetitlen stor og selvsikker (ikke en lille label)?
- [ ] Er der rigelig luft — ånder siden?
- [ ] Er farve brugt som SMÅ accenter (ikon-felter, pills, linjer) — ikke store flader?
- [ ] Er datatabeller rolige, med farve kun i status/tags?
- [ ] Hairline-kanter og fine detaljer frem for tunge kasser?
- [ ] Holder det niveau med referencerne i `references/`? (Kig efter at sammenligne.)
- [ ] Rørt KUN styling/markup — ingen logik/data/migration?

---

## Reference-bank (`references/`)

Kig på disse før du designer. De er brugerens kuraterede smag:
- **Datashake** (api_section, power_your_data, data_foundation): neutralt, stor
  typografi, stiplede linjer, små farvede ikon-checks, masser af luft.
- **Orchestra** (hero, flow_line, section): mørk hero, kursiv serif-accent i store
  titler, dæmpet salvie-grøn palet, raffineret.
- **Wavelength** (hero, product_feature_overview, integrations, customer_success,
  built_for, footer): lyst fundament + mørke kontrast-sektioner, små farvede
  ikon-felter med mørk kant, farvede "kredsløbslinjer" som signatur, farvede tags i
  datatabeller.

Når brugeren tilføjer flere referencer, opdatér denne liste og udled nye fælles træk.
