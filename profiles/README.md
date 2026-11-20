# Profiles

`examples/` holds lighting profiles that can be shared. A profile is a semantic plan input (colors and key ids) with no device data and nothing from the keyboard vendor.

| File | Look |
|---|---|
| `dracula-hacker.json` | Dracula zones: modifiers purple, number row cyan, WASD and arrows green, the rest dim ice white |
| `cat-pixel.json` | Symmetric pixel-art cat face |
| `dracula-cappuccino.json` | Dracula accents and Catppuccin Mocha tones with a pink to mauve to blue gradient |

Each file has `name`, `description`, `model` and `plan`. `plan` is the body of `POST /api/plans/lighting` (or the input of `keyboard_plan_lighting`). Create the plan, preview it, then apply it with `confirm: true`:

```bash
curl -s -H 'Origin: http://127.0.0.1:5173' -H 'Content-Type: application/json' \
  -d "$(jq .plan profiles/examples/dracula-cappuccino.json)" \
  http://127.0.0.1:6465/api/plans/lighting
```

`local/` is ignored by git. It holds the model file, the snapshots and `state/<modelId>.json`, the last configuration the daemon wrote. Without that file a restarted daemon would assume the factory defaults, because the keyboard cannot be read back.
