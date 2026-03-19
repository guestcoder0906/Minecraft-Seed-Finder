import { EventEmitter } from "events";
import { superComplexWasm } from "./superComplexWasm.js";
globalThis.emitter = new EventEmitter();

var jsonStableStringify = (function () {
  var a = function (a, d) {
      d || (d = {}), "function" == typeof d && (d = { cmp: d });
      var e = d.space || "";
      "number" == typeof e && (e = Array(e + 1).join(" "));
      var f = "boolean" == typeof d.cycles ? d.cycles : !1,
        g =
          d.replacer ||
          function (a, b) {
            return b;
          },
        h =
          d.cmp &&
          (function (a) {
            return function (b) {
              return function (c, d) {
                var e = { key: c, value: b[c] },
                  f = { key: d, value: b[d] };
                return a(e, f);
              };
            };
          })(d.cmp),
        i = [];
      return (function j(a, d, k, l) {
        var m = e ? "\n" + new Array(l + 1).join(e) : "",
          n = e ? ": " : ":";
        if (
          (k && k.toJSON && "function" == typeof k.toJSON && (k = k.toJSON()),
          (k = g.call(a, d, k)),
          void 0 !== k)
        ) {
          if ("object" != typeof k || null === k) return JSON.stringify(k);
          if (b(k)) {
            for (var o = [], p = 0; p < k.length; p++) {
              var q = j(k, p, k[p], l + 1) || JSON.stringify(null);
              o.push(m + e + q);
            }
            return "[" + o.join(",") + m + "]";
          }
          if (-1 !== i.indexOf(k)) {
            if (f) return JSON.stringify("__cycle__");
            throw new TypeError("Converting circular structure to JSON");
          }
          i.push(k);
          for (var r = c(k).sort(h && h(k)), o = [], p = 0; p < r.length; p++) {
            var d = r[p],
              s = j(k, d, k[d], l + 1);
            if (s) {
              var t = JSON.stringify(d) + n + s;
              o.push(m + e + t);
            }
          }
          return i.splice(i.indexOf(k), 1), "{" + o.join(",") + m + "}";
        }
      })({ "": a }, "", a, 0);
    },
    b =
      Array.isArray ||
      function (a) {
        return "[object Array]" === {}.toString.call(a);
      },
    c =
      Object.keys ||
      function (a) {
        var b =
            Object.prototype.hasOwnProperty ||
            function () {
              return !0;
            },
          c = [];
        for (var d in a) b.call(a, d) && c.push(d);
        return c;
      };
  return a;
})();
function c(a, b, c) {
  if (a.getNoiseBiomeAreaAtHeightType) {
    var d = c.tileScale;
    if (!c.showBiomes) return null;
    if (b.sizeX % d !== 0 || b.sizeZ % d !== 0)
      throw new Error(
        "Invalid biome scale : " + d + " for size " + b.sizeX + "*" + b.sizeZ,
      );
    var e = c.biomeHeight || "worldSurface",
      f = a.getNoiseBiomeAreaAtHeightType(
        4 * b.x,
        4 * b.z,
        b.sizeX / d,
        b.sizeZ / d,
        4 * d,
        e,
      ),
      g =
        c.showHeights && "worldSurface" === e
          ? a.getApproxSurfaceArea(
              4 * b.x,
              4 * b.z,
              b.sizeX / d,
              b.sizeZ / d,
              4 * d,
              "oceanFloor",
            ).buffer
          : void 0;
    return { biomes: f.buffer, heights: g, scale: d };
  }
  if (!c.showBiomes) return null;
  for (
    var h = a.getInts(4 * b.x, 4 * b.z, 4 * b.sizeX, 4 * b.sizeZ, 63),
      i = new ArrayBuffer(b.sizeX * b.sizeZ),
      j = new Uint8Array(i),
      k = 0,
      l = 0;
    l < 4 * b.sizeZ;
    l += 4
  )
    for (var m = 0; m < 4 * b.sizeX; m += 4) {
      var n = (l * b.sizeX * 4 + m, h[(l + 2) * b.sizeX * 4 + (m + 2)]);
      (j[k] = n), k++;
    }
  return { biomes: i, scale: 1 };
}
  let CB3SharedTaskManager = {
    create: function (a) {
      var b = {};
      return (
        globalThis.emitter.addListener("message", function (c) {
          if ("sharedTaskResult" === c.type) {
            var d = c.key;
            if (!b[d]) return;
            b[d].onResult(c.data.result), delete b[d];
          } else if ("sharedTaskPerform" === c.type) {
            var d = c.key;
            if (!b[d]) return;
            b[d]
              .performTask()
              .then(function (c) {
                globalThis.emitter.emit("message", {
                  type: "sharedTaskPerformResult",
                  key: d,
                  result: c,
                }),
                  b[d].onResult(c),
                  delete b[d];
              })
              .catch(function (a) {
                throw a;
              });
          }
        }),
        {
          handleTask: function (c, d) {
            if (b[c]) throw new Error("task already exists");
            return new Promise(function (e) {
              (b[c] = {
                onResult: e,
                performTask: d,
              }),
                globalThis.emitter.emit("message", {
                  type: "sharedTaskGet",
                  key: c,
                });
            });
          },
        }
      );
    },
  };

  let CB3Libs = superComplexWasm();

  var g = null,
    h = null,
    i = null;
  let j = CB3SharedTaskManager.create(globalThis);
  function a(b, c) {
  if ("object" == typeof b && null != b && "object" == typeof c && null != c) {
    var d = [0, 0];
    for (var e in b) d[0]++;
    for (var e in c) d[1]++;
    if (d[0] - d[1] !== 0) return !1;
    for (var e in b) if (!(e in c && a(b[e], c[e]))) return !1;
    for (var e in c) if (!(e in b && a(c[e], b[e]))) return !1;
    return !0;
  }
  return b === c;
}
function finder(c) {
  if (!a(i, c)) {
    var d = Object.assign({}, c.platform.cb3World, {
      seed: CB3Libs.Long.fromString(c.seed),
    });
    h &&
      (h[CB3Libs.Dimension.Overworld] && h[CB3Libs.Dimension.Overworld].free(),
      h[CB3Libs.Dimension.Nether] && h[CB3Libs.Dimension.Nether].free(),
      h[CB3Libs.Dimension.End] && h[CB3Libs.Dimension.End].free(),
      (h = null)),
      g && (g.free(), (g = null)),
      (h = {}),
      (h[CB3Libs.Dimension.Overworld] = CB3Libs.createBiomeProvider(d)),
      (h[CB3Libs.Dimension.Nether] = new CB3Libs.BiomeProviderNether(d)),
      (h[CB3Libs.Dimension.End] = new CB3Libs.BiomeProviderEnd(d));
    var e = superComplexWasm(jsonStableStringify(d));
    (g = CB3Libs.createPoiFinder(d, h, {
      sharedTask: function (a, b) {
        return j.handleTask(e + "--" + a, b);
      },
    })),
      (i = c);
  }
}
function getResults(a) {
  var b = a.tile,
    f = a.params;
  finder({
    seed: f.seed,
    platform: f.platform,
  });
  var i = {
    x: b.x,
    z: b.z,
    sizeX: b.xL,
    sizeZ: b.zL,
  };
  return g(i, f.pois).then(function (a) {
    var b = null,
      e = h[f.dimension];
    return (
      f.dimension === CB3Libs.Dimension.Overworld
        ? (b = c(e, i, f))
        : f.dimension === CB3Libs.Dimension.Nether
        ? (b = d(e, i, f))
        : f.dimension === CB3Libs.Dimension.End && (b = d(e, i, f)),
      {
        biomes: b ? b.biomes : null,
        biomeScale: b ? b.scale : 1,
        heights: b ? b.heights : null,
        biomeFilter: f.biomeFilter,
        poiResults: a,
      }
    );
  });
}

export function getSupportedPPois(platform) {
  let c = CB3Libs.getSupportedPois(platform.cb3World);
  return {
    type: "getSupportedPois",
    supportedPois: c,
    platform: platform,
  };
}

globalThis.emitter.addListener("message", (result) => {
  if (result.type == "sharedTaskGet") {
    globalThis.emitter.emit("message", {
      key: result.key,
      type: "sharedTaskPerform",
    });
  }
});

/**
 *  Finds the closest structure to a given point
 * @constructor
 * @param {[number, number]} coords - The x and z of the point
 * @param {[number, number][]} features - The features to search
 */
function findClosest(coords, features) {
  let closest = null;
  let closestDistance = null;
  features.forEach((feature) => {
    let distance = Math.sqrt(
      Math.pow(coords[0] - feature[0], 2) + Math.pow(coords[1] - feature[1], 2)
    );
    if (!closest || distance < closestDistance) {
      closest = feature;
      closestDistance = distance;
    }
  });
  return closest;
}

/**
 *  Gets structures in a given area
 * @constructor
 * @param {string} seed - The world seed
 * @param {[number, number]} coords - The x and z of the middle of the area
 * @param {string[]} pois - The structures to search for
 * @param {object} optionals - Optional parameters
 */
export async function getAreaResult(seed, coords, pois, optionals, retryCount = 3) {
  let params = {
    tileSize: 16,
    searchWidth: 8,
    edition: "Java",
    javaVersion: 10210,
    tileScale: 0.25, // retained for other purposes (e.g. biome scaling)
    dimension: "overworld",
    biomeHeight: "worldSurface",
  };
  if (optionals) {
    params = { ...params, ...optionals };
  }
  let [centerX, centerZ] = coords;
  // Calculate the total search area size and the starting (top‐left) coordinates.
  const totalAreaSize = params.searchWidth * params.tileSize;
  const startX = Math.floor(centerX - totalAreaSize / 2);
  const startZ = Math.floor(centerZ - totalAreaSize / 2);

  let request = {
    type: "check",
    params: {
      seed: seed,
      platform: {
        cb3World: {
          edition: params.edition,
          ...(params.edition === "Java" && { javaVersion: params.javaVersion }),
            ...(params.edition === "Bedrock" && { bedrockVersion: 10210 }),
          config: {},
        },
      },
      tileSize: params.tileSize,
      tileScale: params.tileScale,
      biomeFilter: false,
      dimension: params.dimension,
      pois: pois,
      showBiomes: true,
      biomeHeight: params.biomeHeight,
      showHeights: true,
    },
    tile: {
      x: startX,
      z: startZ,
      xL: params.tileSize,
      zL: params.tileSize,
      scale: params.tileScale,
    },
  };

  let allResults = [];

  // Handle stronghold separately if requested.
  let strongholdResult = null;
  if (pois.includes("stronghold")) {
    // Create promise for stronghold.
    strongholdResult = new Promise((resolve) => {
      globalThis.emitter.addListener("message", (result) => {
        if (result.type === "sharedTaskPerformResult") {
          resolve(result.result);
        }
      });
    });
  }

  // Loop over the grid of tiles.
  for (let i = 0; i < params.searchWidth; i++) {
    for (let j = 0; j < params.searchWidth; j++) {
      // Compute the absolute top‐left coordinates for this tile.
      const tileX = startX + j * params.tileSize;
      const tileZ = startZ + i * params.tileSize;
      // Update the request tile coordinates.
      request.tile.x = tileX;
      request.tile.z = tileZ;

      let result;
      let attempts = 0;
      while (attempts < retryCount) {
        try {
          result = await getResults(request);
          break;
        } catch (error) {
          attempts++;
          if (attempts === retryCount) {
            console.error(`Failed after ${retryCount} attempts:`, error);
            throw error;
          }
          // Wait before retrying
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      // Process all structure entries from this tile.
      for (const key in result.poiResults) {
        if (Object.prototype.hasOwnProperty.call(result.poiResults, key)) {
          const entries = result.poiResults[key];
          // Iterate over every returned structure entry (not just the first one).
          for (const entry of entries) {
            // Each entry is expected to be an array: [relativeX, relativeZ, metadata]
            // Compute absolute coordinates: add the tile’s offset plus the relative coordinate scaled by tileSize.
            const relX = entry[0];
            const relZ = entry[1];
            const absX = tileX + relX * params.tileSize;
            const absZ = tileZ + relZ * params.tileSize;
            allResults.push({
              type: key,
              x: Math.round(absX),
              z: Math.round(absZ),
              metadata: entry[2],
            });
          }
        }
      }
    }
  }

  // Wait for and process stronghold results if available.
  if (strongholdResult) {
    strongholdResult = await strongholdResult;
    let closestStronghold = findClosest(coords, strongholdResult);
    allResults.push({
      type: "stronghold",
      x: Math.round(closestStronghold[0] * params.tileSize),
      z: Math.round(closestStronghold[1] * params.tileSize),
      metadata: {},
    });
  }
  return allResults;
}

export { getResults };