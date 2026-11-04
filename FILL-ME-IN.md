# Fill me in

Three short steps. Everything else is automatic.

## 1. Run the setup wizard

Double-click `setup.bat` (or run `npm run setup`).

It will ask for:

| Question | Where to get it |
|---|---|
| Discord bot token | https://discord.com/developers/applications -> your app -> Bot -> Reset Token |
| Your Discord user ID | Discord Settings -> Advanced -> Developer Mode ON, then right-click your name -> Copy User ID. Use the numeric ID, not your username. |
| Bridge port | Just press Enter for `8787` |
| Bridge secret | The wizard generates it. Copy it; the Tampermonkey overlay and Map Editor need it later. |

The wizard also asks for the full GeoGuessr name of any map that still needs one. You can skip a question and edit the file later.

## 2. Fill in the maps

The easiest way is the **Map Editor**:

1. Run `start.bat`.
2. Open `http://127.0.0.1:8787/editor`.
3. Paste the bridge secret when asked.
4. For each map, check the **keywords** and the **search name**. Click **Search** to search GeoGuessr, then **Use this** on the correct result.
5. Click **Test keywords** to make sure each keyword resolves to the intended map.
6. Click **Verify all** to check every search name and ID.
7. Click **Save changes**.

You can also click **Maps** in the Tampermonkey overlay; it opens the editor with the secret already filled in.

Optional: pre-fill known IDs from the community map directory:

```powershell
node scripts/lookup-map-ids.js --write
```

If you prefer editing files, open `config/maps.json`. The only entries that need attention are the ones with:

```json
"geoguessrName": "",
"mapId": "",
```

Right now that is:

- **AOW** — put the full GeoGuessr map name in `geoguessrName`.

For every other map the script will search GeoGuessr automatically the first time it is used, then cache the ID.

### Adding a shorthand

If your friend types something that is not already an alias, add it to that map's `aliases` array. Example:

```json
{
  "shorthand": "comp world",
  "geoguessrName": "A Competitive World",
  "mapId": "668ea3252973190af74233b5",
  "weight": 10,
  "aliases": ["comp", "comp world"]
}
```

This already exists, so `comp NM` works out of the box.

## 3. Create the Discord app

1. Go to https://discord.com/developers/applications and create an application.
2. Open **Bot** and copy/reset the token. Paste it into the setup wizard.
3. Open **Installation** and enable **User Install**.
4. Run `register.bat` and open the install link it prints.
5. In Discord, click **Add to My Apps** (or install it to your account).

Then:

1. Install `userscript/geoguessr-party-autopick.user.js` in Tampermonkey.
2. Run `start.bat`.
3. Open `https://www.geoguessr.com/party/lobby/...`.
4. Click the **GG Autopick** pill in the bottom-right and paste the bridge secret from step 1.
5. Right-click any message in your friend's DM -> **Apps** -> **Apply to GeoGuessr**.

## How to know the maps are understood

Run this after editing `config/maps.json`:

```powershell
npm run verify-maps
```

- **OK** — the ID/slug matches the map name on GeoGuessr.
- **WILL SEARCH** — no ID yet; first use searches by name.
- **MISSING** — add a `geoguessrName` or `mapId`.
- **NAME MISMATCH** — the ID points to the wrong map.

Preview one command:

```powershell
npm run verify-maps -- "comp NM"
```

It shows the matched map, mode, configured ID, cached ID, and what GeoGuessr says the map is called.

You can also use the **Map Editor** at `http://127.0.0.1:8787/editor` and click **Verify all**. It checks configured IDs and searches maps that still need one. Every successful apply also shows `Map: ... | Mode: ...` in the overlay and in the Discord reply.

## Command format

```
<map> [mode]
```

Examples:

- `comp NM`
- `comp` (keeps the current movement setting)
- `NM` (keeps the current map)
- `aarw move`
- `world nmpz`
- `random NM` (weighted random map from your wheel)

Modes: `move`, `nm`, `nmpz`.

If a map has a **default mode**, a map-only message uses it. For example:

- `AMW` -> A Moving World + Move
- `ASW` -> A Skewed World + NMPZ
- `50/50` -> 50/50 world + NMPZ

An explicit mode still overrides: `AMW NM` applies NM. Set default modes in the **Default mode** column of the Map Editor.

## If something is wrong

- **"GeoGuessr tab is not connected"** -> `start.bat` is not running, or the userscript has the wrong secret.
- **"You are not the party host"** -> only the host can change the map.
- **Map not found** -> put the exact GeoGuessr map name in `geoguessrName`, or the map ID in `mapId`.
- **Chrome blocks localhost** -> click the lock icon next to geoguessr.com -> Site settings -> Local network access -> Allow, then reload.
- **After editing `config/maps.json`** -> click **Reload bridge config** in the overlay, or restart `start.bat`.
