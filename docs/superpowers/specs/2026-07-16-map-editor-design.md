# Map Editor Design

## Goal

Add an in-game map editor so the player can directly paint the staggered battle grid, place seven-cell cities, and export the edited grid as source data for a later hand-drawn or generated map.

## Scope

- The first version is an editor layer over the current strategic map.
- It supports terrain painting for `plain`, `road`, `forest`, `hill`, `mountain`, and `deepWater`.
- It supports a city placement brush. Each placed city occupies the existing seven-cell footprint: center cell plus six adjacent staggered-grid neighbors.
- It exports the edited layout as JSON and SVG text.
- It does not mutate the active game state. Closing the editor leaves the current campaign unchanged.

## Interaction

- A `地图编辑` button opens a fixed editor panel.
- The panel has brush buttons for terrain and cities, undo, redo, clear, and export controls.
- Clicking or dragging over cells paints terrain.
- With the city brush selected, clicking a cell places a numbered city marker at that center.
- Export buttons write JSON or SVG into a readonly text area for immediate inspection and later reuse.

## Data Model

The editor owns an independent `MapEditorState`:

- `grid`: copied `GridCell[]` from the current game.
- `cities`: editable city center markers with `id`, `label`, `q`, and `r`.
- `history`: previous snapshots for undo.
- `future`: redo snapshots.

The exported JSON includes `schemaVersion`, `width`, `height`, `grid`, and `cities`.

## Testing

- Unit tests cover painting, city placement, undo/redo, clearing, and exports.
- UI tests cover opening the editor, painting a cell, placing a city, and exporting the result.
