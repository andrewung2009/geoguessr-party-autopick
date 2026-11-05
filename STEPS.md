# Steps from here

Your maps are already saved in `config/maps.json`.

## Every time you want to play

The bridge starts automatically when you log in to Windows.

1. Open your GeoGuessr party lobby: `https://www.geoguessr.com/party/lobby/...`
2. Check the **GG Autopick** pill in the bottom-right of the page. It should say **Connected to bridge**.
3. In Discord, right-click your friend's message (for example `comp NM`).
4. Choose **Apps -> Apply to GeoGuessr**.
5. The GeoGuessr lobby changes to the map + mode. The Discord reply confirms what was applied.

If the message only names the map, the map's **Default mode** is used. For example, `AMW` applies Move, and `ASW` applies NMPZ. An explicit mode overrides it, so `AMW NM` applies NM.

To check or stop it, run `autostart-status.bat` or `uninstall-autostart.bat`. Logs are in `logs/bridge.log`.

## Random mode + country

1. Friend sends `Random NM` (or `Random Move` / `Random NMPZ`).
2. Right-click that message -> **Apps -> Apply to GeoGuessr**. The map stays unchanged and the mode is remembered.
3. Friend sends a country, for example `Portugal`.
4. Right-click that message. The map changes to Portugal and keeps the remembered mode.

Right-click both messages separately. The bot cannot read earlier DMs.

## Change the setup

- **Auto-start off/on:** run `uninstall-autostart.bat` / `install-autostart.bat`.
- **Watch the console:** close the auto-start task, then double-click `start.bat`.
- **Logs:** `logs/bridge.log`.

## One-time setup (only if you have not done it yet)

### Discord app

1. Go to https://discord.com/developers/applications
2. Select your app.
3. Open **Installation** and enable **User Install**.
4. Run **`register.bat`**.
5. Open the install link it prints.
6. Click **Add to My Apps**.
7. Restart Discord if the command does not appear.

### Tampermonkey script

1. Install the Tampermonkey extension in Chrome.
2. Open `userscript/geoguessr-party-autopick.user.js`.
3. Install it in Tampermonkey.

### Bridge secret

1. Open `.env` in Notepad.
2. Copy the value after `BRIDGE_SECRET=`.
3. On the GeoGuessr page, click **GG Autopick -> Settings**.
4. Paste the secret and click **Save**.
5. You only need to do this once per browser.

### Auto-start

1. Double-click `install-autostart.bat`.
2. Run `autostart-status.bat` to confirm the task is installed and the bridge responds.
3. If Task Scheduler is blocked, the installer prints a Startup-folder fallback.

## Map Editor

Use this whenever you want to check or change the maps.

1. Make sure the bridge is running (it starts automatically after `install-autostart.bat`).
2. Click **Maps** in the GG Autopick overlay, or open:
   `http://127.0.0.1:8787/editor`
3. Paste the bridge secret if asked.
4. Edit the **Shorthand**, **Keywords / aliases**, and **Search on GeoGuessr** columns.
5. Click **Search** and then **Use this** to pick the correct GeoGuessr result.
6. Click **Test keywords** to check every keyword points to the right map.
7. Click **Verify all** to check IDs and search names.
8. Click **Save changes**.

## If something does not work

- **Command not in the Discord Apps menu** -> run `register.bat`, enable **User Install**, and restart Discord.
- **Bot rejects you** -> use your numeric Discord user ID instead of `geoandrew` in `.env`.
- **"GeoGuessr tab is not connected"** -> run `autostart-status.bat`; if the bridge is not running, run `install-autostart.bat` or `start.bat`. Check the overlay secret.
- **"You are not the party host"** -> only the party host can change the map.
- **Wrong map is chosen** -> fix that map in the Map Editor, click **Search**, then **Save changes**.
- **Map not found** -> put the exact GeoGuessr map name in the **Search on GeoGuessr** column, or the map ID in the **Map ID** column.

## Useful commands

```powershell
npm run verify-maps
npm run verify-maps -- "comp NM"
node scripts/lookup-map-ids.js --write
npm test
```
