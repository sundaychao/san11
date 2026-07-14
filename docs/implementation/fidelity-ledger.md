# Visual Fidelity Ledger

Reference: `map-concept-v2.png` (approved original ink-wash Jingxiang map)  
Rendered evidence: in-app Browser screenshot at 1440 x 900, captured after a Liu Bei patrol command.

| Comparison point | Reference evidence | Rendered evidence | Resolution |
| --- | --- | --- | --- |
| Terrain composition | Dense mountain wall in the northwest, river basin through the center, wetlands in the south | The production map uses the approved bitmap without repainting or cropping away the defining regions | Match |
| City geography | Eight fortified settlements distributed around roads and waterways | Eight interactive city markers use the scenario coordinates and remain aligned during pan and zoom | Match with functional overlay |
| Ink-wash palette | Muted green, gray stone, pale water, aged paper edges | UI panels use dark ink green with restrained gold, leaving terrain colors dominant | Match |
| Strategic information density | Reference leaves clear terrain around settlements | Compact force, city, and troop labels expose game state without hiding the route network | Intentional gameplay addition |
| Desktop composition | Wide landscape designed for a map-first view | 1440 x 900 keeps 1120 px for the map, with a fixed 320 px city operations panel | Match with management panel |
| Supporting instruments | Original concept contains only landscape and settlements | Bottom-left event log, bottom-right minimap, and top map tools follow the SAN11-inspired command surface | Intentional gameplay addition |
| Typography and controls | Traditional painted setting with no embedded interface type | Kai-style display type and compact sans-serif data reinforce the setting; Lucide icons identify commands | Intentional code-native UI |
| Mobile adaptation | No mobile reference was supplied | 390 x 844 preserves a full-height map and a 208 px bottom sheet with all six commands visible | Responsive deviation required by spec |

No commercial game assets, interface textures, portraits, or copied text are used. The approved original map is the only bitmap production asset; all controls, markers, panels, and responsive states are code-native.
