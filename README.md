# Brian Radaren

Lille webapp der crawler danske RSS-feeds, finder artikler med:

- Brian

Og viser de 50 seneste matches i et "Brian"-inspireret design.

## Koer lokalt

```bash
npm install
npm start
```

Aabn derefter:

`http://localhost:3000`

## API

- `GET /api/news` henter cachede resultater (cache ca. 5 minutter).
- `GET /api/news?refresh=1` tvinger ny crawl.
- `GET /api/health` simpel health-check.

## Bemaerkning om datadaekning

Loesningen henter fra en bred gruppe danske RSS-kilder samt Bing News RSS-soegninger for de tre noegleord.
Ikke alle danske medier udstiller komplette eller aabne RSS-feeds, saa "alle danske nyheder" er praktisk set tilnaermet med de tilgaengelige kilder.
