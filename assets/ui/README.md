# Field-kit UI asset pack

Original vector artwork for Escape from Cardkov. These files are created for this project; they contain no extracted game artwork, fonts, logos, or proprietary texture files.

| Asset | Purpose |
| --- | --- |
| `insignia.svg`, `favicon.svg` | Cut-metal crossed-card field insignia and browser icon |
| `worn-metal.svg` | 384px repeatable charcoal/olive painted steel; deterministic scratches |
| `field-paper.svg` | 256px repeatable aged card stock; quiet surface for readable blue effects |
| `ballistic-nylon.svg` | 64px repeatable woven military fabric |
| `hud-corners.svg` | Scalable 240×160 transparent metal mounting corners and rivets |
| `slot-corners.svg` | Scalable empty inventory slot guide |
| `reticle.svg` | Transparent 128px target guide |
| `frame-{normal,rare,epic,unique,legendary,mystic}.svg` | Transparent 160×224 metal rim/corner overlays; six rarity colors |
| `field-icons.svg` | External SVG symbol sprite: health, armor, energy, shield, stress, vulnerable, seal, curse, unstable, erosion, pierce, shatter, delay, currency, backpack, warehouse, forge, reroll, draw, extract |

Load `asset-theme.css` after the existing stylesheets. It keeps their responsive layout and overlays the field-kit palette, textures and art. The existing CSS metallic gradient rim remains in place; vector frame corners provide small scratches and hardware details.

For external icons use `<svg aria-hidden="true"><use href="assets/ui/field-icons.svg#health"/></svg>` and provide the accessible name on the enclosing control. Illustrations inside card faces and inventory tiles are decorative; their neighboring title and effect text provide the information.

Raster art paths expected by the theme: `assets/generated/menu.webp`, `assets/generated/base.webp`. Card art uses `.card-art img`; inventory uses `img.asset-icon`; equipment can use `img.equipment-art`. No runtime download, external library, or GPU texture shader is required.
