# Cardkov pixel field-kit UI

Original angular UI artwork for Escape from Cardkov. The world is designed around 48×72-pixel actors, 32×32 inventory objects and 96×64 card illustrations. UI text remains normal, sharp HTML Korean and numbers.

All SVGs use integer geometry and `shape-rendering="crispEdges"`. Surfaces are quiet flat colors with a few large wear marks. Frames use exactly three metal tones—shadow, base and highlight—with no gradients, blur, grain or procedural noise. Existing rarity names and colors remain normal grey, rare green, epic blue, unique purple, legendary yellow and mystic red.

| Asset | Purpose |
| --- | --- |
| `insignia.svg`, `favicon.svg` | 32×32 angular crossed-card field insignia |
| `worn-metal.svg` | 96×96 quiet charcoal steel repeat |
| `field-paper.svg` | 96×96 light card stock repeat; readable blue effect text |
| `ballistic-nylon.svg` | 64×64 flat military fabric bands |
| `hud-corners.svg` | Scalable 240×160 transparent mounting corners |
| `slot-corners.svg` | 64×64 angular storage slot guide |
| `reticle.svg` | 64×64 target corners and cross |
| `frame-{normal,rare,epic,unique,legendary,mystic}.svg` | 160×224 three-tone angular card hardware |
| `field-icons.svg` | 20 external 24×24 symbols with integer paths and square ends |

Load `asset-theme.css` last. It preserves the existing responsive layout, hidden-art rules and touch targets, replaces continuous gloss with three hard color bands, and displays raster illustrations with nearest-neighbor scaling. Effect text is bold blue; added tooltip values stay orange. Card image names and ownership are managed separately by the main art catalog.

External icon example: `<svg aria-hidden="true"><use href="assets/ui/field-icons.svg#health"/></svg>`. Give the accessible name on the enclosing control. Decorative art never takes pointer or drag events.

Symbols: health, armor, energy, shield, stress, vulnerable, seal, curse, unstable, erosion, pierce, shatter, delay, currency, backpack, warehouse, forge, reroll, draw, extract.

The theme expects `assets/pixel/menu.png` and `assets/pixel/base.png`. Other images use `.card-art img`, `img.asset-icon`, `.equipment-art` and `.operator-avatar img`. No runtime library or generated-image API is required.
