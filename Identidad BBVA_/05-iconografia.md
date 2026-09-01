# 05 · Iconografía

## Catálogo BBVA

171 iconos oficiales BBVA disponibles en `./docs/visual/icons/` como SVG. Color por defecto: Electric Blue (`#001391`).

Úsalos así:

```html
<img src="./docs/visual/icons/bank.svg" alt="Banco" width="32" height="32" class="bbva-icon">
```

Sobre fondos azules (Electric, Midnight), los iconos en azul no se ven. Para invertirlos a blanco:

```css
.bbva-combo--electric .bbva-icon,
.bbva-combo--midnight .bbva-icon {
  filter: brightness(0) invert(1);
}
```

(Ya está aplicado en `tokens.css`.)

Tamaños habituales (siempre múltiplo de 8): 16, 20, 24, 32, 48, 64 px.

---

## Lista completa (171 iconos)

Categorizados de forma orientativa para que sea fácil localizar el adecuado.

### Banca y dinero
`account`, `atm`, `autobank`, `bank`, `balancedollar`, `balanceeuro`, `balancesoles`, `bitcoin`, `bizum`, `blockcard`, `bonusaccount`, `chargecard`, `chargemobile`, `chip`, `copycreditcard`, `currencyexchange`, `deposit`, `digitalcard`, `disabledcard`, `discount`, `dollar`, `dollartaxes`, `freedollar`, `freeeuro`, `yen`

### Acciones / UI
`add`, `addnotes`, `advance`, `alarm`, `alphabeticalorder`, `archivemail`, `arrows`, `attached`, `back`, `backmini`, `block`, `bookmark`, `bookmarkfilled`, `changecamera`, `check`, `checkmark`, `clock`, `close`, `closemini`, `collapse`, `color`, `configuration`, `continue`, `continueleft`, `continueright`, `copy`, `delete`, `dislike`, `divider`, `favorite`, `favoritefilled`, `favoritehalffilled`, `feedback`, `filter`, `first`, `fixed`, `fold`, `folder`, `frequency`, `funtionalsquare`

### Tecnología y digital
`360mobileview`, `ai`, `android`, `appstore`, `audio`, `auto`, `automate`, `automaticaccess`, `barcode`, `biometric`, `blindapp`, `bluetooth`, `chat`, `chatgptsimple`, `cloud`, `csv`, `database`, `desktop`, `digitalhandwriting`, `digitalpress`, `digitalsignature`, `digitaltv`, `faceid`, `fingerprint`, `wikimetrics`, `word`, `xml`, `youtube`, `youtubemusic`, `youtubemusicsimple`, `youtubesimple`, `zip`

### Redes sociales
`behance`, `behancesimple`, `blog`, `facebook`, `facebookmessenger`, `facebooksimple`, `flickr`, `flickrsimple`

### Productos y servicios BBVA
`bbvacontigo`, `bbvavalora`, `behaviouraleconomics`, `channels`, `clientok`, `climateaction`, `commercialoffer`, `communication`, `correos`, `cultureandtalent`, `dimo`, `dimosimple`, `financialhealth`

### Lugares y comercio
`bakery`, `bar`, `bookstore`, `cinema`, `coffeeshop`, `confectionery`, `fastfood`, `florist`

### Personas
`baby`, `children`, `couple`, `decease`, `female`, `woman`

### Hogar y construcción
`aerothermalunit`, `balcony`, `bath`, `bed`, `boiler`, `concretemixer`, `cone`, `constructionhelmet`, `constructionstopped`, `crane`, `window`

### Transporte y movilidad
`aeroplane`, `babycart`, `bicycle`, `crossway`, `delivery`, `football`, `forbiddentopassinfrontbus`

### Salud y accesibilidad
`accessibility`, `accessibletoilet`, `cleanliness`, `cookies`, `diaper`, `dna`, `fireextinguisher`, `frozen`

### Otros
`addressbook`, `addtocart`, `angry`, `bigglass`, `blue`, `circle`, `directory`, `document`, `forest`, `wrong`, `wronglocation`, `womenshoe`

---

## Si no encuentras el icono que necesitas

- Busca por sinónimo en la lista.
- Considera si puedes prescindir del icono — a veces un texto bien tipografiado es mejor.
- **No mezcles** con iconos de Material, Font Awesome, Heroicons, Lucide, etc. Rompe la coherencia visual.
- **No improvises** un SVG nuevo que "imite" el estilo BBVA. Si el icono no está, mejor sin icono.
