# Parity Map — moved

The cross-platform parity map (GuitarTap ↔ guitar_tap ↔ GuitarTapWeb) is no longer
hand-maintained here. It is **generated** from co-located `@parity <slug>` tags in
each mirrored source file and lives in the **canonical Swift repo**:

- Map (human-browseable): `GuitarTap/PARITY-MAP.md`
- Database (machine-readable): `GuitarTap/parity-index.json`
- Regenerate / verify: `GuitarTap/Tooling/parity/gen_parity_map.py [--check]`
- Look up counterparts: `GuitarTap/Tooling/parity/parity_lookup.py <substring>`

To find where a web module lives in Swift/Python (or vice versa), grep the file for
its `@parity` slug, then look that slug up — or Ctrl-F the path in the generated map.
When you add or move a mirrored file, add/adjust its `@parity` tag and rerun the
generator; `--check` fails CI if the committed map drifts or a slug lands in only one
repo. See `PHASE6-PARITY.md` § 6-MAP for the design.