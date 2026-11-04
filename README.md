# GeoGuessr Party Autopick

Apply a GeoGuessr party map and movement setting from a Discord message, without clicking through the map picker.

Example: your friend sends `comp NM` in a Discord DM. You right-click that message, choose **Apps -> Apply to GeoGuessr**, and the party lobby switches to **A Competitive World** with **No Move**.

## Quick start

1. Double-click `setup.bat`. It creates `.env` and asks for your Discord token, user ID, and the full name of any map that still needs one.
2. Edit `config/maps.json` if the wizard left any `geoguessrName` blank.
3. Double-click `register.bat` and open the install link it prints. Enable **User Install** in the Discord Developer Portal first.
4. Install `userscript/geoguessr-party-autopick.user.js` in Tampermonkey.
5. Double-click `start.bat`.
6. Open a GeoGuessr party lobby, click **GG Autopick**, and paste the bridge secret from `.env`.
7. Right-click a message in the Discord DM -> **Apps** -> **Apply to GeoGuessr**.

See `FILL-ME-IN.md` for the checklist with screenshots-in-words.

## Why the right-click step?

A Discord bot cannot read normal DMs between two users. Reading them would require a self-bot, which violates Discord's Terms of Service. A message context-menu command is the official workaround: the bot receives the message you right-clicked, and your friend does not have to change anything.

## How it works

```
Friend's DM: "comp NM"
        |
        v
You right-click -> Apps -> Apply to GeoGuessr
        |
        v
Discord app (user-install message command)
        |
        v
Local bridge on 127.0.0.1:8787
        |
        v
Tampermonkey userscript on geoguessr.com/party
        |
        v
PUT /api/v4/parties/v2/game-settings
```

The userscript uses your existing GeoGuessr browser session. No cookies or passwords are stored. Only the map and movement flags are changed; timers, health, power-ups, and party settings stay as they are.

### GeoGuessr endpoints used

| Purpose | Endpoint |
|---|---|
| Read the current party | `GET /api/v4/parties/v2/active` |
| Change only game settings | `PUT /api/v4/parties/v2/game-settings` |
| Search for a map by name | `GET /api/v3/search/map?q=...` |
| Current user profile | `GET /api/v3/profiles` (optional diagnostics) |

These are GeoGuessr's internal web endpoints. They can change without notice. The script reports failures in the overlay and in Discord instead of failing silently.

## Command format

```
<map> [mode]
```

| Message | Result |
|---|---|
| `comp NM` | A Competitive World + No Move |
| `comp` | map only, movement unchanged |
| `NM` | movement only, map unchanged |
| `aarw move` | An Arbitrary Rural World + Move |
| `world nmpz` | World + NMPZ |
| `random NM` | weighted random map from your wheel + No Move |

Modes:

- `move` / `moving` -> moving, zooming, rotating allowed
- `nm` / `no move` -> no moving, zooming and rotating allowed
- `nmpz` -> no moving, no panning, no zooming

If a single token is a mode word, it is treated as movement-only.

### Default mode

Each map can have a default mode used when the message only names the map:

- `AMW` -> A Moving World + Move
- `AMMW` -> A Modified Moving World + Move
- `ASW` -> A Skewed World + NMPZ
- `ARPZW` -> A Random Pan & Zoom World + NMPZ
- `50/50` -> 50/50 world + NMPZ

An explicit mode overrides it: `AMW NM` applies NM. Maps with no default mode keep the current movement setting.

To select **A Moving World** by name, use `amw`, `YB`, or `A Moving World NM`; a bare `moving` is treated as the mode.

## Map configuration

Everything editable lives in `config/maps.json`:

```json
{
  "shorthand": "comp world",
  "geoguessrName": "A Competitive World",
  "mapId": "668ea3252973190af74233b5",
  "weight": 10,
  "aliases": ["comp", "comp world"]
}
```

- `shorthand` is the map's unique key.
- `geoguessrName` is the exact GeoGuessr name used for searching.
- `mapId` is optional. If present, no search is needed.
- `aliases` are extra words that select this map.
- `weight` is only used by `random`.

Unknown names are searched automatically the first time. The resolved ID is saved in `config/map-cache.json`, so later commands are instant. You can delete that file or use **Clear cached IDs** in the overlay to force a fresh search.

## Files

```
config/maps.json                 <- edit this
config/map-cache.json            <- generated automatically
src/bridge.js                    <- local HTTP bridge + command queue
src/discord.js                   <- Discord bot + interaction handler
src/register.js                  <- registers the context-menu command
src/config.js                    <- .env + maps.json loading
src/parser.js                    <- command parsing and alias resolution
scripts/verify-maps.js           <- checks map names/IDs against GeoGuessr
scripts/lookup-map-ids.js        <- fills missing IDs from the community map directory
editor/editor.html               <- browser Map Editor
userscript/geoguessr-party-autopick.user.js
setup.js                         <- interactive setup wizard
setup.bat / register.bat / start.bat
test/parser.test.js
```

## Map Editor

Start the bridge, then open:

```
http://127.0.0.1:8787/editor
```

You can also click **Maps** in the Tampermonkey overlay; it opens the editor with the bridge secret already filled in.

The editor lets you:

- edit the **shorthand**, **keywords/aliases**, **GeoGuessr search name**, **map ID/slug**, **default mode**, and weight
- click **Search** to search GeoGuessr using your open session, then **Use this** on the correct result
- click **Verify** for one map or **Verify all** for every map
- click **Test keywords** to check that every shorthand and alias resolves to the intended map
- see keyword conflicts at the top
- preview a command like `comp NM`
- click **Save changes** to write `config/maps.json`

Search needs the GeoGuessr party page open with the Tampermonkey script connected. Editing, saving, ID verification, and command preview work without it.

You can also pre-fill IDs from the community map directory:

```powershell
node scripts/lookup-map-ids.js --write
npm run verify-maps
```

The lookup only fills maps that do not already have an ID, and `verify-maps` confirms the IDs against GeoGuessr.

## How to check the map mapping

Run:

```powershell
npm run verify-maps
```

This checks every configured map:

- **OK** — the ID/slug was fetched from GeoGuessr and the name matches.
- **WILL SEARCH** — no ID yet; the first use will search by name.
- **MISSING** — no `geoguessrName` and no `mapId`; fill one in.
- **NAME MISMATCH** — the ID points to a different map; fix it.
- **FETCH ERROR** — the ID/slug is invalid or GeoGuessr is unreachable.

Preview exactly what one command will do:

```powershell
npm run verify-maps -- "comp NM"
```

It prints the matched shorthand, GeoGuessr name, configured ID, cached ID, and the actual GeoGuessr name.

In the overlay:

- **Resolve all maps** searches every map that has no ID yet and reports failures.
- Every apply shows `Map: ... | Mode: ...` in the overlay log.
- The Discord reply shows the same result.
- `config/map-cache.json` stores shorthand -> ID. Open `https://www.geoguessr.com/maps/<id>` to confirm a cached map.

## Manual testing

You can test the whole bridge without Discord:

```powershell
# 1. Start the bridge
npm start

# 2. In another terminal, send a test command
$secret = (Get-Content .env | Select-String '^BRIDGE_SECRET=').ToString().Split('=')[1]
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8787/command `
  -Headers @{ 'X-Bridge-Secret' = $secret } `
  -ContentType 'application/json' `
  -Body '{"text":"comp NM","wait":true}'
```

Or use the input box in the **GG Autopick** overlay; it does not require Discord.

## Security notes

- `.env` contains your bot token and bridge secret. It is excluded by `.gitignore`. Do not share it.
- The bridge listens on `127.0.0.1` only and requires the shared secret.
- The Discord command only accepts your Discord user ID(s).
- The script never stores your GeoGuessr password or session cookie.
- No self-bot / user-account automation is used.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `BRIDGE_SECRET is missing` | Run `setup.bat`. |
| `DISCORD_TOKEN is missing` | Run `setup.bat` and paste the bot token. |
| Command not in Discord Apps menu | Run `register.bat`, make sure **User Install** is enabled, and restart Discord. Global commands can take a few minutes to appear. |
| `GeoGuessr tab is not connected` | Run `start.bat`; check the overlay secret matches `.env`. |
| `You are not the party host` | Only the party host can change settings. |
| `Could not find "..."` | Put the exact GeoGuessr name in `geoguessrName`, or the map ID in `mapId`. |
| Chrome blocks localhost | Site settings for geoguessr.com -> Local network access -> Allow, then reload. |
| Wrong map chosen by search | Add the correct `mapId` to `config/maps.json` and clear the cache. |
| Changed `maps.json` but nothing changed | Click **Reload bridge config**, or restart `start.bat`. |

## License

MIT. Use at your own risk. GeoGuessr's internal API is unofficial and may change.
