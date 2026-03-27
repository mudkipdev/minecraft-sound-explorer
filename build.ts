const MANIFEST_URL = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";

type VersionManifest = {
    latest: { release: string; snapshot: string };
    versions: { id: string; type: string; url: string }[];
};

type AssetIndex = {
    objects: Record<string, { hash: string; size: number }>;
};

type SoundsJson = Record<string, {
    sounds: (string | { name: string; [k: string]: unknown })[];
    subtitle?: string;
}>;

type SoundVariant = {
    hash: string;
    size: number;
};

type SoundCatalog = {
    version: string;
    generatedAt: string;
    sounds: Record<string, SoundVariant[]>;
};

async function fetchJSON<T>(url: string): Promise<T> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
    return res.json() as Promise<T>;
}

function cdnUrl(hash: string): string {
    return `https://resources.download.minecraft.net/${hash.slice(0, 2)}/${hash}`;
}

async function build() {
    console.log("Fetching version manifest...");
    const manifest = await fetchJSON<VersionManifest>(MANIFEST_URL);
    const latestId = manifest.latest.release;
    const latestVersion = manifest.versions.find((v) => v.id === latestId);
    if (!latestVersion) throw new Error(`Version ${latestId} not found`);

    console.log(`Latest release: ${latestId}`);
    console.log("Fetching version metadata...");
    const versionMeta = await fetchJSON<{ assetIndex: { url: string } }>(
        latestVersion.url,
    );

    console.log("Fetching asset index...");
    const assetIndex = await fetchJSON<AssetIndex>(versionMeta.assetIndex.url);

    // Fetch sounds.json from the asset index via CDN
    const soundsJsonEntry = assetIndex.objects["minecraft/sounds.json"];
    if (!soundsJsonEntry) throw new Error("minecraft/sounds.json not found in asset index");

    console.log("Fetching sounds.json...");
    const soundsJson = await fetchJSON<SoundsJson>(cdnUrl(soundsJsonEntry.hash));

    // Build a lookup from file path to { hash, size }
    const assetLookup = new Map<string, { hash: string; size: number }>();
    const prefix = "minecraft/sounds/";
    for (const [path, meta] of Object.entries(assetIndex.objects)) {
        if (path.startsWith(prefix) && path.endsWith(".ogg")) {
            assetLookup.set(path.slice(prefix.length), meta);
        }
    }

    // Build catalog using sounds.json event keys
    const sounds: Record<string, SoundVariant[]> = {};

    for (const [key, def] of Object.entries(soundsJson)) {
        const variants: SoundVariant[] = [];
        for (const s of def.sounds) {
            const name = typeof s === "string" ? s : s.name;
            const path = name + ".ogg";
            const asset = assetLookup.get(path);
            if (asset) {
                variants.push({ hash: asset.hash, size: asset.size });
            }
        }
        if (variants.length > 0) {
            sounds[key] = variants;
        }
    }

    const catalog: SoundCatalog = {
        version: latestId,
        generatedAt: new Date().toISOString(),
        sounds,
    };

    console.log(`Found ${Object.keys(sounds).length} sound events`);

    await Bun.write("dist/sounds.json", JSON.stringify(catalog));
    console.log("Wrote dist/sounds.json");

    const html = await Bun.file("index.html").text();
    await Bun.write("dist/index.html", html);
    console.log("Wrote dist/index.html");
}

build().catch((err) => {
    console.error(err);
    process.exit(1);
});