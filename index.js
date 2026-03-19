import express from "express";
import { getAreaResult, getResults } from "./locator.js";
import http from "http";
import pLimit from 'p-limit';

const app = express();
const port = process.env.PORT || 3000;

// Serve static files from the "public" folder
app.use(express.static("public"));
app.get("/", (req, res) => {
  res.sendFile("index.html", { root: "public" });
});

// Default configuration (backend defaults; may be overridden by client config)
const defaultConfig = {
  version: "1.21",
  edition: "Java",
  startingSeed: BigInt("-9223372036854775807"),
  seedRangeMin: BigInt("-9223372036854775807"),
  seedRangeMax: BigInt("9223372036854775807"),
  searchCenter: [0, 0],
  useSpawnForSearchCenter: true,
  selectedStructures: [],
  clusteredStructures: [],
  minClusterCount: 2,
  requiredBiomes: [], // default empty so that "Intermontane Plateau" is only added if the user selects it
  clusteredBiomes: [],
  invalidClusterCombinations: [],
  clusterMaxRange: 32,
  autoStop: true,
  targetCount: 1,
  detectBiomes: false, // now off by default
  searchDistance: 1000,
  // Advanced (hidden)
  tileSize: 16,
  tileScale: 0.25,
  biomeHeight: "worldSurface",
  roughTerrainWindowSize: 3,
  roughTerrainVarianceThreshold: 50,
  plateauBoundaryHighPercentage: 0.75,
  slopeTolerance: 4,
  plateauHeightDiffThreshold: 16,
  mountainEncirclementHeightDiffThreshold: 8,
  valleyHeightDiffThreshold: 16,  // Lowered to detect flatter valleys
  valleyBoundaryHighPercentage: 0.5,  // Reduced to detect valleys with less distinct walls
  valleySlopeBuffer: 8,  // Increased to better detect gentle slopes
  maxWallDistance: 20, // Increased to capture wider valleys
  valleyExplorationThreshold: 4, // New: threshold for valley region expansion
};

const BIOME_ID_TO_NAME = {
  0: "Ocean",
  1: "Plains",
  2: "Desert",
  3: "Windswept Hills",
  4: "Forest",
  5: "Taiga",
  6: "Swamp",
  7: "River",
  10: "Frozen Ocean",
  11: "Frozen River",
  12: "Snowy Plains",
  13: "Snowy Mountains",
  14: "Mushroom Fields",
  15: "Mushroom Fields Shore",
  16: "Beach",
  17: "Desert Hills",
  18: "Windswept Forest",
  19: "Taiga Hills",
  20: "Mountain Edge",
  21: "Jungle",
  22: "Jungle Hills",
  23: "Sparse Jungle",
  24: "Deep Ocean",
  25: "Stony Shore",
  26: "Snowy Beach",
  27: "Birch Forest",
  28: "Birch Forest Hills",
  29: "Dark Forest",
  30: "Snowy Taiga",
  31: "Snowy Taiga Hills",
  32: "Old Growth Pine Taiga",
  33: "Giant Tree Taiga Hills",
  34: "Wooded Mountains",
  35: "Savanna",
  36: "Savanna Plateau",
  37: "Badlands",
  38: "Wooded Badlands",
  39: "Badlands Plateau",
  44: "Warm Ocean",
  45: "Lukewarm Ocean",
  46: "Cold Ocean",
  47: "Deep Warm Ocean",
  48: "Deep Lukewarm Ocean",
  49: "Deep Cold Ocean",
  50: "Deep Frozen Ocean",
  129: "Sunflower Plains",
  130: "Desert Lakes",
  131: "Windswept Gravelly Hills",
  132: "Flower Forest",
  133: "Taiga Mountains",
  134: "Swamp Hills",
  140: "Ice Spikes",
  149: "Modified Jungle",
  151: "Modified Jungle Edge",
  155: "Old Growth Birch Forest",
  156: "Tall Birch Hills",
  157: "Dark Forest Hills",
  158: "Snowy Taiga Mountains",
  160: "Old Growth Spruce Taiga",
  161: "Giant Spruce Taiga Hills",
  162: "Gravelly Mountains+",
  163: "Windswept Savanna",
  164: "Shattered Savanna Plateau",
  165: "Eroded Badlands",
  166: "Modified Wooded Badlands Plateau",
  167: "Modified Badlands Plateau",
  168: "Bamboo Jungle",
  169: "Bamboo Jungle Hills",
  174: "Dripstone Caves",
  175: "Lush Caves",
  177: "Meadow",
  178: "Grove",
  179: "Snowy Slopes",
  180: "Frozen Peaks",
  181: "Jagged Peaks",
  182: "Stony Peaks",
  183: "Deep Dark",
  184: "Mangrove Swamp",
  185: "Cherry Grove",
  163: "Pale Garden",
  // Custom biomes “Island”, “Intermontane Plateau”, and “Valley” are produced by detection functions.
};

function arePatchesAdjacent(patchA, patchB) {
  return (
    patchA.maxCellX >= patchB.minCellX - 1 &&
    patchA.minCellX <= patchB.maxCellX + 1 &&
    patchA.maxCellY >= patchB.minCellY - 1 &&
    patchA.minCellY <= patchB.maxCellY + 1
  );
}

function calculateBiomePatches(biomeArray, gridSize, worldStartX, worldStartZ) {
  const visited = new Array(gridSize * gridSize).fill(false);
  const patches = [];
  const getIndex = (x, y) => y * gridSize + x;
  const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const idx = getIndex(x, y);
      if (visited[idx]) continue;
      const biomeId = biomeArray[idx];
      const queue = [[x, y]];
      const patchCells = [];
      visited[idx] = true;
      while (queue.length > 0) {
        const [cx, cy] = queue.shift();
        patchCells.push([cx, cy]);
        for (const [dx, dy] of neighbors) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= gridSize || ny >= gridSize) continue;
          const nidx = getIndex(nx, ny);
          if (!visited[nidx] && biomeArray[nidx] === biomeId) {
            visited[nidx] = true;
            queue.push([nx, ny]);
          }
        }
      }
      const sumCoords = patchCells.reduce((acc, [px, py]) => [acc[0] + px, acc[1] + py], [0, 0]);
      const centroidX = Math.round(sumCoords[0] / patchCells.length);
      const centroidY = Math.round(sumCoords[1] / patchCells.length);
      const worldX = worldStartX + centroidX * 16 + 8;
      const worldZ = worldStartZ + centroidY * 16 + 8;
      const cellSet = new Set(patchCells.map(([px, py]) => `${px},${py}`));
      const borderCells = [];
      // Expand the boundary detection to include cells near the current boundary
      const boundaryBuffer = 2;  // Adjust this number to control how much you expand the boundary

      for (const [px, py] of patchCells) {
        let isBorder = false;

        for (const [dx, dy] of neighbors) {
          for (let i = 1; i <= boundaryBuffer; i++) {  // Adding a buffer for better boundary detection
            const nx = px + dx * i;
            const ny = py + dy * i;

            if (!cellSet.has(`${nx},${ny}`)) {
              isBorder = true;
              break;
            }
          }
          if (isBorder) break;
        }

        if (isBorder) borderCells.push([px, py]);
      }
      let bestCell = patchCells[0];
      let bestDist = 0;
      for (const [px, py] of patchCells) {
        let minDist = Infinity;
        for (const [bx, by] of borderCells) {
          const dx = px - bx;
          const dy = py - by;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < minDist) {
            minDist = dist;
          }
        }
        if (minDist > bestDist) {
          bestDist = minDist;
          bestCell = [px, py];
        }
      }
      const innerWorldX = worldStartX + bestCell[0] * 16 + 8;
      const innerWorldZ = worldStartZ + bestCell[1] * 16 + 8;
      const xs = patchCells.map(cell => cell[0]);
      const ys = patchCells.map(cell => cell[1]);
      const minCellX = Math.min(...xs);
      const maxCellX = Math.max(...xs);
      const minCellY = Math.min(...ys);
      const maxCellY = Math.max(...ys);

      patches.push({
        biomeId,
        biomeName: BIOME_ID_TO_NAME[biomeId] || `Unknown(${biomeId})`,
        size: patchCells.length,
        mainCoord: [worldX, worldZ],
        gridCoord: [centroidX, centroidY],
        innerCoord: bestCell,
        innerWorldCoord: [innerWorldX, innerWorldZ],
        minCellX,
        maxCellX,
        minCellY,
        maxCellY,
        cells: patchCells
      });
    }
  }
  return patches;
}

function formatElapsedTime(totalSec) {
  const hr = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const sec = totalSec % 60;
  let formatted = "";
  if (hr > 0) formatted += hr + "hr ";
  if (m > 0 || hr > 0) formatted += m + "m ";
  formatted += sec + " sec";
  return formatted;
}

async function detectBiomesForSeed(seedStr, isActive, config) {
  if (!isActive()) {
    sendLog("Scan stopped by user.");
    return;  // Gracefully exit the scan function without throwing an error
  }
  console.log(`Starting biome detection for seed ${seedStr}`);
  // Compute the tile size exactly as in the old method:
  const A = config.searchDistance * 0.5;
  const S = Math.ceil(A / 4); // S now defines the size of the biome grid
  const worldStartX = config.searchCenter[0] - config.searchDistance;
  const worldStartZ = config.searchCenter[1] - config.searchDistance;
  // Use the computed S for tileSize and derive tile coordinates exactly as in the old version:
  const reqTileSize = S;
  const reqTileX = worldStartX / 16;
  const reqTileZ = worldStartZ / 16;

  const request = {
    type: "check",
    params: {
      seed: seedStr,
      platform: {
        cb3World: {
          edition: config.edition,
          ...(config.edition === "Java" && { javaVersion: 10210 }),
          ...(config.edition === "Bedrock" && { bedrockVersion: 10210 }),
          config: {},
        },
      },
      // Use the computed tile size instead of hard-coded 16:
      tileSize: reqTileSize,
      tileScale: 1,
      biomeFilter: false,
      dimension: "overworld",
      pois: [],
      showBiomes: true,
      // Use the configured biomeHeight (e.g. "worldSurface")
      biomeHeight: config.biomeHeight,
      showHeights: true,
    },
    tile: {
      x: reqTileX,
      z: reqTileZ,
      xL: reqTileSize,
      zL: reqTileSize,
      scale: 1,
    },
  };

  try {
    if (!isActive()) return null;  // Check before async call
    const result = await getResults(request);
    if (!isActive()) {
      sendLog("Scan stopped by user during biome detection.");
      return;  // Gracefully exit the scan function without throwing an error
    }
    const biomeArray = new Uint8Array(result.biomes);
    const heights = result.heights ? new Uint16Array(result.heights) : null;

    if (!heights || heights.length === 0) {
      console.warn(`Height data is missing for seed ${seedStr}.`);
    }

    const patches = calculateBiomePatches(biomeArray, S, worldStartX, worldStartZ);
    if (!isActive()) {
      sendLog("Scan stopped by user after biome patches were calculated.");
      return;  // Gracefully exit the scan function without throwing an error
    }
    // In the old method a unique set of biome names was kept – you may add it if needed:
    const uniqueBiomeNames = new Set();
    for (let i = 0; i < biomeArray.length; i++) {
      await new Promise(resolve => setTimeout(resolve, 0)); // yield in a tight loop
      if (!isActive()) {
        sendLog("Scan stopped by user during biome name collection.");
        return;  // Gracefully exit the scan function without throwing an error
      }
      const biomeId = biomeArray[i];
      const biomeName = BIOME_ID_TO_NAME[biomeId] || "Pale Garden";
      uniqueBiomeNames.add(biomeName);
    }

    return {
      biomeArray,
      heights,
      patches,
      gridSize: S,
      worldStartX,
      worldStartZ,
      uniqueBiomeNames,
    };
  } catch (error) {
    if (!isActive()) {
      sendLog("Scan stopped by user during error handling.");
      return;  // Gracefully exit the scan function without throwing an error
    }
    console.error(`Error during biome detection for seed ${seedStr}:`, error);
    return null;
  }
}

function detectIslands(biomeData) {
  const { biomeArray, gridSize, worldStartX, worldStartZ } = biomeData;
  const oceanBiomes = new Set([
    "Ocean", "Frozen Ocean", "Deep Ocean",
    "Warm Ocean", "Lukewarm Ocean", "Cold Ocean",
    "Deep Warm Ocean", "Deep Lukewarm Ocean", "Deep Cold Ocean", "Deep Frozen Ocean"
  ]);
  const visited = new Array(gridSize * gridSize).fill(false);
  const islands = [];
  const getIndex = (x, y) => y * gridSize + x;
  const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      if (x % 5 === 0) {
        // Yield every 5 iterations
      }
      const idx = getIndex(x, y);
      const biomeId = biomeArray[idx];
      const biomeName = BIOME_ID_TO_NAME[biomeId] || `Unknown(${biomeId})`;
      if (oceanBiomes.has(biomeName)) continue;
      if (visited[idx]) continue;
      const stack = [[x, y]];
      const component = [];
      visited[idx] = true;
      let touchesEdge = false;
      while (stack.length > 0) {
        const [cx, cy] = stack.pop();
        component.push([cx, cy]);
        if (cx === 0 || cy === 0 || cx === gridSize - 1 || cy === gridSize - 1) {
          touchesEdge = true;
        }
        for (const [dx, dy] of neighbors) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= gridSize || ny >= gridSize) continue;
          const nidx = getIndex(nx, ny);
          if (!visited[nidx]) {
            const nBiomeId = biomeArray[nidx];
            const nBiomeName = BIOME_ID_TO_NAME[nBiomeId] || `Unknown(${nBiomeId})`;
            if (!oceanBiomes.has(nBiomeName)) {
              visited[nidx] = true;
              stack.push([nx, ny]);
            }
          }
        }
      }
      if (touchesEdge) continue;
      let sumX = 0, sumY = 0;
      for (const [cx, cy] of component) {
        sumX += cx;
        sumY += cy;
      }
      const avgX = Math.round(sumX / component.length);
      const avgY = Math.round(sumY / component.length);
      const worldX = worldStartX + avgX * 16 + 8;
      const worldZ = worldStartZ + avgY * 16 + 8;
      islands.push({ center: [worldX, worldZ], size: component.length });
    }
  }
  return islands;
}

function detectEncirclingTerrains(biomeData, config) {
  const { heights, gridSize, worldStartX, worldStartZ } = biomeData;
  const expectedLength = gridSize * gridSize;
  let hArray;

  // Prepare the height array (supporting two possible formats)
  if (!heights) {
    console.warn("No height data available for terrain patch detection");
    return [];
  } else if (heights.length === 2 * expectedLength) {
    hArray = new Uint16Array(expectedLength);
    for (let i = 0; i < expectedLength; i++) {
      hArray[i] = heights[i * 2];
    }
  } else if (heights.length === expectedLength) {
    hArray = heights;
  } else {
    console.warn("Unexpected height data length:", heights.length);
    return [];
  }

  // Configuration parameters:
  const patchDiffThreshold = config.patchDiffThreshold || 16;
  const plateauBoundaryHighPercentage = config.plateauBoundaryHighPercentage || 0.8;
  const minRegionSize = config.minRegionSize || 31;
  const mergeDistance = config.mergeDistance || 5;

  // Keep track of cells already processed (inner or boundary)
  const visited = new Array(expectedLength).fill(false);
  const patches = [];

  const getIndex = (x, y) => y * gridSize + x;
  const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  // Iterate over every cell in the grid.
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const idx = getIndex(x, y);
      if (visited[idx]) continue;

      let region = [];
      let regionSet = new Set();
      let stack = [[x, y]];
      let localMin = hArray[idx];
      let touchesEdge = false;

      while (stack.length > 0) {
        const [cx, cy] = stack.pop();
        const cidx = getIndex(cx, cy);
        if (regionSet.has(cidx)) continue;
        regionSet.add(cidx);

        const ch = hArray[cidx];
        if (ch < localMin) {
          localMin = ch;
        }
        region.push([cx, cy]);

        if (cx === 0 || cy === 0 || cx === gridSize - 1 || cy === gridSize - 1) {
          touchesEdge = true;
        }

        for (const [dx, dy] of neighbors) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= gridSize || ny >= gridSize) continue;
          const nidx = getIndex(nx, ny);
          if (regionSet.has(nidx)) continue;
          if (hArray[nidx] <= localMin + patchDiffThreshold) {
            stack.push([nx, ny]);
          }
        }
      }

      for (const [rx, ry] of region) {
        visited[getIndex(rx, ry)] = true;
      }

      if (touchesEdge) continue;

      let boundarySet = new Set();
      for (const [cx, cy] of region) {
        for (const [dx, dy] of neighbors) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= gridSize || ny >= gridSize) continue;
          const nidx = getIndex(nx, ny);
          if (!regionSet.has(nidx)) {
            boundarySet.add(`${nx},${ny}`);
          }
        }
      }

      const boundary = Array.from(boundarySet).map(coord => coord.split(',').map(Number));
      // Combine the inner region and boundary arrays (grid coordinates)
      const unionCoords = region.concat(boundary);

      // Compute the bounding box in grid coordinates
      const xs = unionCoords.map(coord => coord[0]);
      const zs = unionCoords.map(coord => coord[1]);
      const minGridX = Math.min(...xs);
      const maxGridX = Math.max(...xs);
      const minGridZ = Math.min(...zs);
      const maxGridZ = Math.max(...zs);

      // Convert the bounding box to world coordinates
      const worldMinX = worldStartX + minGridX * 16 + 8;
      const worldMaxX = worldStartX + maxGridX * 16 + 8;
      const worldMinZ = worldStartZ + minGridZ * 16 + 8;
      const worldMaxZ = worldStartZ + maxGridZ * 16 + 8;

      //console.log("Bounding Box (world coords):", {worldMinX, worldMaxX, worldMinZ, worldMaxZ});

      let highBoundaryCount = 0;
      let boundaryHeights = [];
      for (const [bx, by] of boundary) {
        const bh = hArray[getIndex(bx, by)];
        boundaryHeights.push(bh);
        if (bh >= localMin + patchDiffThreshold) {
          highBoundaryCount++;
        }
      }
      if (boundary.length === 0) continue;
      if (highBoundaryCount < boundary.length * plateauBoundaryHighPercentage) continue;

      const avgRegion = region.reduce((sum, [rx, ry]) => sum + hArray[getIndex(rx, ry)], 0) / region.length;
      const avgBoundary = boundaryHeights.reduce((sum, h) => sum + h, 0) / boundaryHeights.length;

      if (avgBoundary - avgRegion < patchDiffThreshold) continue;
      if (region.length < minRegionSize) continue;

      let sumX = 0, sumY = 0;
      for (const [rx, ry] of region) {
        sumX += rx;
        sumY += ry;
      }
      const centerX = Math.round(sumX / region.length);
      const centerY = Math.round(sumY / region.length);

      let duplicateFound = false;
      for (const existingPatch of patches) {
        const dx = existingPatch.centerGrid[0] - centerX;
        const dy = existingPatch.centerGrid[1] - centerY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < mergeDistance) {
          duplicateFound = true;
          break;
        }
      }
      if (duplicateFound) continue;

      const worldX = worldStartX + centerX * 16 + 8;
      const worldZ = worldStartZ + centerY * 16 + 8;

      for (const [bx, by] of boundary) {
        visited[getIndex(bx, by)] = true;
      }

      patches.push({
        center: [worldX, worldZ],
        innerRegion: region,
        boundary: boundary,
        worldMinX: worldMinX,
        worldMaxX: worldMaxX,
        worldMinZ: worldMinZ,
        worldMaxZ: worldMaxZ,
        size: region.length,
        avgHigh: avgBoundary,
        avgLow: avgRegion,
        centerGrid: [centerX, centerY]
      });
    }
  }

  return patches;
}

/**
 * NEW: Detect Encirclement Centers.
 *
 * This function clusters all patches whose biome name includes "peaks" (ignoring case).
 * For each cluster, it computes the exact (axis–aligned) bounding box of all the patches in that cluster,
 * then checks whether there is at least one non–peaks patch whose inner world coordinate lies strictly
 * inside that bounding box. If so, the center of the bounding box is returned as the unique encirclement point.
 */
function detectEncirclementCenters(biomeData, isActive) {
  const { patches, gridSize, worldStartX, worldStartZ } = biomeData;
  const peakPatches = patches.filter(patch =>
    patch.biomeName.toLowerCase().includes("peaks")
  );

  const peakClusters = [];
  const visited = new Set();

  for (let i = 0; i < peakPatches.length; i++) {
    if (!isActive()) {
      console.log("Scan stopped during encirclement clustering.");
      return;  // Gracefully exit the scan function without throwing an error
    }
    if (visited.has(i)) continue;

    const cluster = [];
    const stack = [i];

    while (stack.length) {
      if (!isActive()) {
        console.log("Scan stopped during encirclement stack processing.");
        return;  // Gracefully exit the scan function without throwing an error
      }

      const idx = stack.pop();
      if (visited.has(idx)) continue;

      visited.add(idx);
      cluster.push(peakPatches[idx]);

      for (let j = 0; j < peakPatches.length; j++) {
        if (!visited.has(j) && arePatchesAdjacent(peakPatches[idx], peakPatches[j])) {
          stack.push(j);
        }
      }
    }
    peakClusters.push(cluster);
  }

  const encirclements = [];

  for (const cluster of peakClusters) {
    let minCellX = Infinity, minCellY = Infinity;
    let maxCellX = -Infinity, maxCellY = -Infinity;

    for (const patch of cluster) {
      minCellX = Math.min(minCellX, patch.minCellX);
      minCellY = Math.min(minCellY, patch.minCellY);
      maxCellX = Math.max(maxCellX, patch.maxCellX);
      maxCellY = Math.max(maxCellY, patch.maxCellY);
    }

    const boxMinX = worldStartX + minCellX * 16;
    const boxMaxX = worldStartX + (maxCellX + 1) * 16;
    const boxMinY = worldStartZ + minCellY * 16;
    const boxMaxY = worldStartZ + (maxCellY + 1) * 16;

    const innerCandidates = patches.filter(patch => {
      if (patch.biomeName.toLowerCase().includes("peaks")) return false;
      const [wx, wz] = patch.innerWorldCoord;
      return wx > boxMinX && wx < boxMaxX && wz > boxMinY && wz < boxMaxY;
    });

    if (innerCandidates.length === 0) continue;

    const centerX = worldStartX + ((minCellX + maxCellX + 1) / 2) * 16;
    const centerY = worldStartZ + ((minCellY + maxCellY + 1) / 2) * 16;
    const areaSize = innerCandidates.length; // Area is based on the number of patches inside

    encirclements.push({ center: [Math.round(centerX), Math.round(centerY)], size: areaSize });
  }

  return {
    centers: encirclements.map(e => e.center),
    areas: encirclements.map(e => e.size)
  };
}

function isStructureWithinEncirclingTerrain(structure, biomeData, config) {
  const plateaus = detectEncirclingTerrains(biomeData, config);

  for (const plat of plateaus) {
    // Convert world coordinates of the structure to grid coordinates.
    const structureGridX = Math.floor((structure.x - biomeData.worldStartX) / 16);
    const structureGridZ = Math.floor((structure.z - biomeData.worldStartZ) / 16);

    // Check if the structure is within the inner region (lower terrain).
    const isInInnerRegion = plat.innerRegion.some(([x, z]) => x === structureGridX && z === structureGridZ);

    // Check if the structure is within the boundary (encircling higher terrain).
    const isInBoundary = plat.boundary.some(([x, z]) => x === structureGridX && z === structureGridZ);

    // If the structure is in either the inner region or the boundary, return true.
    if (isInInnerRegion || isInBoundary) {
      return true;
    }
  }

  // If no encircling terrain contains the structure, return false.
  return false;
}

function detectValleys(biomeData, config) {
  const { heights, gridSize, worldStartX, worldStartZ } = biomeData;
  const expectedLength = gridSize * gridSize;
  let hArray;
  const valleyExplorationThreshold = config.valleyExplorationThreshold ?? 4;

  // Ensure height data is available
  if (!heights) {
    console.warn("No height data available for valley detection");
    return [];
  } else if (heights.length === 2 * expectedLength) {
    // Handle 2-byte height data
    hArray = new Uint16Array(expectedLength);
    for (let i = 0; i < expectedLength; i++) {
      hArray[i] = heights[i * 2];
    }
  } else if (heights.length === expectedLength) {
    hArray = heights;
  } else {
    console.warn("Unexpected height data length:", heights.length);
    return [];
  }

  console.log(`Starting valley detection with gridSize: ${gridSize}x${gridSize}`);
  const visited = new Array(gridSize * gridSize).fill(false);
  const valleys = [];
  const getIndex = (x, y) => y * gridSize + x;
  // Include diagonal directions to improve valley shape detection
  const directions = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [-1, -1], [1, -1], [-1, 1]
  ];

  // Loop over each cell to find low regions
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const idx = getIndex(x, y);
      if (visited[idx]) continue; // Skip already visited cells

      const stack = [[x, y]];
      const lowRegion = [];
      let minLow = hArray[idx];
      let touchesEdge = false;

      // Explore connected low regions
      while (stack.length > 0) {
        const [cx, cy] = stack.pop();
        const cidx = getIndex(cx, cy);
        if (visited[cidx]) continue;
        visited[cidx] = true;
        const currentHeight = hArray[cidx];
        lowRegion.push([cx, cy]);
        if (currentHeight < minLow) minLow = currentHeight;
        if (cx === 0 || cy === 0 || cx === gridSize - 1 || cy === gridSize - 1) {
          touchesEdge = true;
        }
        for (const [dx, dy] of directions) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= gridSize || ny >= gridSize) continue;
          const nidx = getIndex(nx, ny);
          if (!visited[nidx] && hArray[nidx] <= currentHeight + valleyExplorationThreshold) {
            stack.push([nx, ny]);
          }
        }
      }

      // Detect surrounding walls for the current low region
      const boundary = new Set();
      let maxHigh = minLow;
      const dynamicWallDistance = Math.max(
        config.maxWallDistance,
        Math.floor(Math.sqrt(lowRegion.length)) * 3
      );
      for (const [cx, cy] of lowRegion) {
        for (const [dx, dy] of directions) {
          let wallX = cx, wallY = cy;
          let prevHeight = hArray[getIndex(cx, cy)];
          for (let distance = 0; distance < dynamicWallDistance; distance++) {
            wallX += dx;
            wallY += dy;
            if (wallX < 0 || wallY < 0 || wallX >= gridSize || wallY >= gridSize) break;
            const wallIdx = getIndex(wallX, wallY);
            const wallHeight = hArray[wallIdx];
            if (wallHeight <= prevHeight + config.valleySlopeBuffer) break;
            boundary.add(`${wallX},${wallY}`);
            prevHeight = wallHeight;
            if (wallHeight > maxHigh) maxHigh = wallHeight;
          }
        }
      }

      // Log and skip valley candidates with no boundary
      if (boundary.size === 0) {
        console.log(`Valley candidate at cell (${x},${y}) rejected: No surrounding wall detected.`);
        continue;
      }
      const boundaryCoords = Array.from(boundary).map(coord => coord.split(',').map(Number));
      const heightDifference = maxHigh - minLow;
      const adaptiveHeightDiffThreshold = Math.max(
        config.valleyHeightDiffThreshold,
        lowRegion.length / 20
      );
      if (heightDifference < config.valleyHeightDiffThreshold) {
        console.log(`Valley candidate at cell (${x},${y}) rejected: Height difference ${heightDifference} is less than threshold ${adaptiveHeightDiffThreshold}.`);
        continue;
      }
      const highBoundaryCells = boundaryCoords.filter(
        ([bx, by]) => hArray[getIndex(bx, by)] >= minLow + config.valleySlopeBuffer
      ).length;
      if (highBoundaryCells < boundaryCoords.length * config.valleyBoundaryHighPercentage) {
        console.log(`Valley candidate at cell (${x},${y}) rejected: Only ${highBoundaryCells} high boundary cells out of ${boundaryCoords.length} (required ${Math.round(boundaryCoords.length * config.valleyBoundaryHighPercentage)}).`);
        continue;
      }

      const avgX = Math.round(lowRegion.reduce((sum, [x]) => sum + x, 0) / lowRegion.length);
      const avgY = Math.round(lowRegion.reduce((sum, [, y]) => sum + y, 0) / lowRegion.length);
      const worldCenterX = worldStartX + avgX * 16 + 8;
      const worldCenterZ = worldStartZ + avgY * 16 + 8;
      console.log(`Valley candidate accepted at (${worldCenterX}, ${worldCenterZ}) with minLow: ${minLow} and maxHigh: ${maxHigh}.`);
      valleys.push({
        region: lowRegion,
        boundary: boundaryCoords,
        minLow,
        maxHigh,
        worldCenter: [worldCenterX, worldCenterZ]
      });
    }
  }
  console.log(`Valley detection complete. Found ${valleys.length} valleys.`);
  console.log("Grouping valleys...");
  const groupedValleys = groupValleys(valleys, gridSize, worldStartX, worldStartZ);
  console.log(`Grouping complete. Found ${groupedValleys.length} valley groups.`);
  return groupedValleys;
}

// This helper only returns true if regionB directly overlaps (or touches via a cardinal neighbor)
// the base regionA. (No chain merging is done.)
function areDirectlyOverlapping(regionA, regionB) {
  const setA = new Set(regionA.map(([x, y]) => `${x},${y}`));
  // Only consider the cell itself and the four cardinal (non-diagonal) neighbors.
  const neighbors = [
    [0, 0],  // the cell itself
    [1, 0],  // right
    [-1, 0], // left
    [0, 1],  // down
    [0, -1]  // up
  ];
  for (const [x, y] of regionB) {
    for (const [dx, dy] of neighbors) {
      if (setA.has(`${x + dx},${y + dy}`)) {
        console.log(
          `Direct overlap detected: cell (${x + dx}, ${y + dy}) from base region overlaps with cell (${x}, ${y}) of candidate valley.`
        );
        return true;
      }
    }
  }
  return false;
}

function groupValleys(valleys, gridSize, worldStartX, worldStartZ) {
  const valleyGroups = [];
  const grouped = new Set();

  for (let i = 0; i < valleys.length; i++) {
    if (grouped.has(i)) continue;
    const valley = valleys[i];
    const groupValleys = [valley];
    grouped.add(i);
    const baseRegion = valley.region;

    for (let j = i + 1; j < valleys.length; j++) {
      if (grouped.has(j)) continue;
      const otherValley = valleys[j];
      if (otherValley.region && areDirectlyOverlapping(baseRegion, otherValley.region)) {
        console.log(`Valley at center (${otherValley.worldCenter[0]}, ${otherValley.worldCenter[1]}) directly touches the base valley; adding to group.`);
        groupValleys.push(otherValley);
        grouped.add(j);
      }
    }

    const avgX = Math.round(groupValleys.reduce((sum, v) => sum + v.worldCenter[0], 0) / groupValleys.length);
    const avgZ = Math.round(groupValleys.reduce((sum, v) => sum + v.worldCenter[1], 0) / groupValleys.length);

    // Combine all coordinates from the valleys in this group
    const allCoords = groupValleys.flatMap(v => v.region);

    valleyGroups.push({
      worldCenter: [avgX, avgZ],
      valleys: groupValleys,
      allCoords: allCoords // Add this line
    });
  }

  console.log(`Grouping complete. Found ${valleyGroups.length} valley groups.`);
  return valleyGroups;
}

// --- Helper Function ---
function areRegionsTouching(regionA, regionB) {
  const setA = new Set(regionA.map(([x, y]) => `${x},${y}`));
  for (const [x, y] of regionB) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      const neighbor = `${x + dx},${y + dy}`;
      if (setA.has(neighbor)) return true;
    }
  }
  return false;
}

function detectRoughTerrain(biomeData, config) {
  const { heights, gridSize, worldStartX, worldStartZ } = biomeData;
  if (!heights) {
    console.warn("No height data available for rough terrain detection");
    return [];
  }
  const windowSize = config.roughTerrainWindowSize;
  const halfWindow = Math.floor(windowSize / 2);
  const roughCells = new Array(gridSize * gridSize).fill(false);
  const getIndex = (x, y) => y * gridSize + x;
  for (let y = halfWindow; y < gridSize - halfWindow; y++) {
    for (let x = halfWindow; x < gridSize - halfWindow; x++) {
      const values = [];
      for (let dy = -halfWindow; dy <= halfWindow; dy++) {
        for (let dx = -halfWindow; dx <= halfWindow; dx++) {
          values.push(heights[getIndex(x + dx, y + dy)]);
        }
      }
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
      if (variance >= config.roughTerrainVarianceThreshold) {
        roughCells[getIndex(x, y)] = true;
      }
    }
  }
  const visited = new Array(gridSize * gridSize).fill(false);
  const patches = [];
  const neighbors = [
    [1, 0], [-1, 0], [0, 1], [0, -1],  // Cardinal directions
    [1, 1], [-1, -1], [1, -1], [-1, 1] // Diagonal directions
  ];
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const idx = getIndex(x, y);
      if (!roughCells[idx] || visited[idx]) continue;
      const patchCells = [];
      const stack = [[x, y]];
      visited[idx] = true;
      while (stack.length > 0) {
        const [cx, cy] = stack.pop();
        patchCells.push([cx, cy]);
        for (const [dx, dy] of neighbors) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= gridSize || ny >= gridSize) continue;
          const nidx = getIndex(nx, ny);
          if (roughCells[nidx] && !visited[nidx]) {
            visited[nidx] = true;
            stack.push([nx, ny]);
          }
        }
      }
      const sum = patchCells.reduce((acc, [px, py]) => [acc[0] + px, acc[1] + py], [0, 0]);
      const centroidX = Math.round(sum[0] / patchCells.length);
      const centroidY = Math.round(sum[1] / patchCells.length);
      const worldX = worldStartX + centroidX * 16 + 8;
      const worldZ = worldStartZ + centroidY * 16 + 8;
      patches.push({
        biomeName: "Rough Terrain",
        size: patchCells.length,
        center: [worldX, worldZ],
        cells: patchCells
      });
    }
  }
  return patches;
}

// Helper function to check if a structure's coordinates are found in a filledArea array
function isStructureWithinFilledArea(structure, filledArea) {
  for (let i = 0; i < filledArea.length; i++) {
    const [x, z] = filledArea[i];
    // Log each coordinate check if needed:
    // console.log(`Checking filledArea cell [${x}, ${z}] against structure [${structure.x}, ${structure.z}]`);
    if (structure.x === x && structure.z === z) {
      return true;
    }
  }
  return false;
}

function isStructureInBiome(structure, biomeData, requiredBiome, config, criteria = {}) {
  if (!biomeData || !biomeData.patches) return false;
  const { worldStartX, worldStartZ } = biomeData;
  const margin = 16;
  // Handle all biomes (standard and custom)
  const processBiomePatch = (patch) => {
    if (criteria.minSize != null && patch.size < Number(criteria.minSize)) return false;
    if (criteria.maxSize != null && patch.size > Number(criteria.maxSize)) return false;

    const minX = worldStartX + patch.minCellX * 16 - margin;
    const maxX = worldStartX + patch.maxCellX * 16 + 16 + margin;
    const minZ = worldStartZ + patch.minCellY * 16 - margin;
    const maxZ = worldStartZ + patch.maxCellY * 16 + 16 + margin;

    return structure.x >= minX && structure.x <= maxX &&
           structure.z >= minZ && structure.z <= maxZ;
  };

  // Check for standard biomes
  const standardPatches = biomeData.patches.filter(patch => patch.biomeName === requiredBiome);
  for (const patch of standardPatches) {
    if (processBiomePatch(patch)) return true;
  }

  // For standard (built–in) biomes:
  if (requiredBiome !== "Island" && requiredBiome !== "Encircling Terrain" && requiredBiome !== "Valley") {
    for (const patch of biomeData.patches) {
      if (patch.biomeName === requiredBiome) {
        // Check patch size criteria if set:
        if (criteria.minSize != null && criteria.minSize !== "" && patch.size < Number(criteria.minSize))
          continue;
        if (criteria.maxSize != null && criteria.maxSize !== "" && patch.size > Number(criteria.maxSize))
          continue;

        const minX = worldStartX + patch.minCellX * 16 - margin;
        const maxX = worldStartX + patch.maxCellX * 16 + 16 + margin;
        const minZ = worldStartZ + patch.minCellY * 16 - margin;
        const maxZ = worldStartZ + patch.minCellY * 16 + 16 + margin;
        if (structure.x >= minX && structure.x <= maxX &&
            structure.z >= minZ && structure.z <= maxZ) {
          return true;
        }
      }
    }
    return false;
  }

  // For custom biome "Island":
  if (requiredBiome === "Island") {
    const islands = detectIslands(biomeData);
    for (const island of islands) {
      if (criteria.minSize != null && criteria.minSize !== "" && island.size < Number(criteria.minSize))
        continue;
      if (criteria.maxSize != null && criteria.maxSize !== "" && island.size > Number(criteria.maxSize))
        continue;
      const radius = 8 * Math.sqrt(island.size);
      const dx = structure.x - island.center[0];
      const dz = structure.z - island.center[1];
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist <= radius + margin) {
        return true;
      }
    }
    return false;
  }

  // For custom biome "Encircling Terrain":
  if (requiredBiome === "Encircling Terrain") {
    const plateaus = detectEncirclingTerrains(biomeData, config);
    for (const plat of plateaus) {
      if (criteria.minSize != null && criteria.minSize !== "" && plat.size < Number(criteria.minSize))
        continue;
      if (criteria.maxSize != null && criteria.maxSize !== "" && plat.size > Number(criteria.maxSize))
        continue;
      if (
        structure.x >= plat.worldMinX &&
        structure.x <= plat.worldMaxX &&
        structure.z >= plat.worldMinZ &&
        structure.z <= plat.worldMaxZ
      ) {
        return true;
      }
    }
    return false;
  }

  // For custom biome "Valley":
  if (requiredBiome === "Valley") {
    const valleyGroups = detectValleys(biomeData, config);
    for (const group of valleyGroups) {
      const xs = group.allCoords.map(coord => coord[0]);
      const ys = group.allCoords.map(coord => coord[1]);
      const minCellX = Math.min(...xs);
      const maxCellX = Math.max(...xs);
      const minCellY = Math.min(...ys);
      const maxCellY = Math.max(...ys);
      const patchSize = group.allCoords.length;
      if (criteria.minSize != null && criteria.minSize !== "" && patchSize < Number(criteria.minSize))
        continue;
      if (criteria.maxSize != null && criteria.maxSize !== "" && patchSize > Number(criteria.maxSize))
        continue;
      const minX = biomeData.worldStartX + minCellX * 16;
      const maxX = biomeData.worldStartX + (maxCellX + 1) * 16;
      const minZ = biomeData.worldStartZ + minCellY * 16;
      const maxZ = biomeData.worldStartZ + (maxCellY + 1) * 16;
      if (structure.x >= minX && structure.x <= maxX &&
          structure.z >= minZ && structure.z <= maxZ) {
        return true;
      }
    }
    return false;
  }

  return false;
}

function getSurfaceHeightAtPosition(biomeData, x, z) {
  const { heights, gridSize, worldStartX, worldStartZ } = biomeData;

  if (!heights || heights.length === 0) {
    console.log(`Error: No height data available for coordinates (${x}, ${z}).`);
    return undefined;
  }

  const relativeX = Math.floor((x - worldStartX) / 16);
  const relativeZ = Math.floor((z - worldStartZ) / 16);

  const index = (relativeZ * gridSize + relativeX) * 2; // *2 because Uint16Array stores 2 bytes per value
  const surfaceHeight = heights[index] | (heights[index + 1] << 8);

  if (surfaceHeight === 0) {
    console.log(`Warning: Surface height at (${x}, ${z}) is zero. Potential missing data or incorrect mapping.`);
  } else {
    console.log(`Surface height at (${x}, ${z}) is ${surfaceHeight}.`);
  }
  return surfaceHeight;
}

async function scanSeeds(sendLog, isActive, config) {
  const workerCount = 15;
  let seedsScanned = 0;
  let foundSeeds = 0;
  const startTime = Date.now();
  let lastLiveUpdate = startTime;
  let targetReached = false;
  let currentSeed = config.startingSeed; // BigInt

  // Helper to yield every few iterations and check for abort conditions.
  async function yieldIfNeeded(iteration) {
    if (iteration % 5 === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
      if (!isActive() || targetReached || foundSeeds >= config.targetCount) {
        return;
      }
    }
  }

  // Process one seed.
  async function processSeed(seed) {
    if (!isActive() || targetReached) return;
    const seedStr = seed.toString();
    try {
      // Ensure "spawn" is among selected structures if using it for the search center.
      if (config.useSpawnForSearchCenter) {
        if (!config.selectedStructures.some(struct => struct[0] === "spawn")) {
          config.selectedStructures.push(["spawn", 1]);
        }
      }
      if (!isActive() || targetReached) {
        sendLog("Scan stopped by user before requesting area result.");
        return;
      }

      const structures = await getAreaResult(
        seedStr,
        config.searchCenter,
        [
          ...config.selectedStructures.map(s => Array.isArray(s) ? s[0] : s),
          ...config.clusteredStructures
        ],
        {
          edition: config.edition,
          javaVersion: config.edition === "Java" ? 10210 : undefined,
          bedrockVersion: config.edition === "Bedrock" ? 10210 : undefined,
          tileScale: config.tileScale,
          dimension: "overworld",
          biomeHeight: config.biomeHeight,
          showBiomes: config.detectBiomes,
          showHeights: true,
        }
      );

      if (!isActive() || targetReached) {
        sendLog("Scan stopped by user.");
        return;
      }
      // Filter out structures outside the search distance.
      const validStructures = structures.filter(s => {
        const dx = Math.abs(s.x - config.searchCenter[0]);
        const dz = Math.abs(s.z - config.searchCenter[1]);
        return dx <= config.searchDistance && dz <= config.searchDistance;
      });
      if (!isActive() || targetReached) {
        sendLog("Scan stopped by user before processing structures.");
        return;
      }
      // Update search center based on spawn if needed.
      if (config.useSpawnForSearchCenter) {
        if (!isActive() || targetReached) {
          sendLog("Scan stopped by user.");
          return;
        }
        const spawnStructure = validStructures.find(s => s.type.toLowerCase() === "spawn");
        config.searchCenter = spawnStructure ? [spawnStructure.x, spawnStructure.z] : [0, 0];
      }

      // Determine if biome data is needed.
      let needsBiomeData = false;
      for (let i = 0; i < config.selectedStructures.length; i++) {
        await yieldIfNeeded(i);
        const req = config.selectedStructures[i];
        const criteria = Array.isArray(req) ? (req[2] || {}) : {};
        if (criteria.biome || criteria.minHeight != null || criteria.maxHeight != null) {
          needsBiomeData = true;
          break;
        }
      }
      if ((config.requiredBiomes && config.requiredBiomes.length > 0) ||
          (config.clusteredBiomes && config.clusteredBiomes.length > 0)) {
        needsBiomeData = true;
      }
      if (!isActive() || targetReached) {
        sendLog("Scan stopped by user.");
        return;
      }
      let biomeData = null;
      if (needsBiomeData) {
        if (!isActive() || targetReached) {
          sendLog("Scan stopped by user.");
          return;
        }
        config.detectBiomes = true;
        biomeData = await detectBiomesForSeed(seedStr, isActive, config);
        if (!isActive() || targetReached) {
          sendLog("Scan stopped by user.");
          return;
        }
        if (!biomeData) {
          sendLog(`Warning: Biome data could not be retrieved for seed ${seedStr}.`);
        }
      }
      if (!isActive() || targetReached) {
        sendLog("Scan stopped by user.");
        return;
      }

      // Check each required structure.
      let meetsSelectedStructures = true;
      for (let i = 0; i < config.selectedStructures.length; i++) {
        await yieldIfNeeded(i);
        const req = config.selectedStructures[i];
        let reqType, reqMin, criteria = {};
        if (Array.isArray(req)) {
          reqType = req[0];
          reqMin = req[1] || 1;
          criteria = req[2] || {};
        } else {
          reqType = req;
          reqMin = 1;
        }
        let matches = validStructures.filter(s => s.type === reqType);
        if (criteria.minHeight != null && criteria.minHeight !== "") {
          matches = matches.filter(s => {
            if (!isActive() || targetReached) {
              sendLog("Scan stopped by user.");
              return;
            }
            const surfaceHeight = getSurfaceHeightAtPosition(biomeData, s.x, s.z);
            const heightToCheck = surfaceHeight !== undefined ? surfaceHeight : s.y;
            if (heightToCheck === undefined) {
              sendLog(`Warning: Both surface height and structure Y are undefined for ${s.type} at (${s.x}, ${s.z}).`);
              return false;
            }
            return heightToCheck >= criteria.minHeight;
          });
        }
        if (criteria.maxHeight != null && criteria.maxHeight !== "") {
          matches = matches.filter(s => {
            if (!isActive() || targetReached) {
              sendLog("Scan stopped by user.");
              return;
            }
            const surfaceHeight = getSurfaceHeightAtPosition(biomeData, s.x, s.z);
            const heightToCheck = surfaceHeight !== undefined ? surfaceHeight : s.y;
            if (heightToCheck === undefined) {
              sendLog(`Warning: Both surface height and structure Y are undefined for ${s.type} at (${s.x}, ${s.z}).`);
              return false;
            }
            return heightToCheck <= criteria.maxHeight;
          });
        }
        if (criteria.biome) {
          if (!isActive() || targetReached) {
            sendLog("Scan stopped by user.");
            return;
          }
          if (biomeData) {
            matches = matches.filter(s => isStructureInBiome(s, biomeData, criteria.biome, config, criteria));
          } else {
            matches = [];
          }
        }
        if (matches.length < reqMin) {
          meetsSelectedStructures = false;
          break;
        }
      }

      // Check clustered structure requirements.
      const reqClusteredStructuresActive = config.clusteredStructures && config.clusteredStructures.length > 0;
      let meetsClusteredStructures = true;
      let structureClusters = [];
      if (reqClusteredStructuresActive) {
        if (!isActive() || targetReached) {
          sendLog("Scan stopped by user.");
          return;
        }
        const clusteredToCheck = validStructures.filter(s =>
          config.clusteredStructures.includes(s.type)
        );
        let visited = new Set();
        for (let i = 0; i < clusteredToCheck.length; i++) {
          if (visited.has(i)) continue;
          let cluster = [clusteredToCheck[i]];
          visited.add(i);
          const queue = [i];
          while (queue.length > 0) {
            const currentIdx = queue.shift();
            const currentStructure = clusteredToCheck[currentIdx];
            for (let j = 0; j < clusteredToCheck.length; j++) {
              if (visited.has(j)) continue;
              const nextStructure = clusteredToCheck[j];
              const dx = currentStructure.x - nextStructure.x;
              const dz = currentStructure.z - nextStructure.z;
              const dist = Math.sqrt(dx * dx + dz * dz);
              if (dist <= config.clusterMaxRange) {
                cluster.push(nextStructure);
                visited.add(j);
                queue.push(j);
              }
            }
          }
          if (cluster.length >= 2) {
            structureClusters.push(cluster);
          }
        }
        meetsClusteredStructures = structureClusters.length > 0;
      }

      // Check required biomes and clustered biomes.
      const reqBiomesActive = config.requiredBiomes && config.requiredBiomes.length > 0;
      const reqClusteredBiomesActive = config.clusteredBiomes && config.clusteredBiomes.length > 0;
      let meetsRequiredBiomes = true;
      let meetsClusteredBiomes = true;
      let biomeClusters = [];
      if (config.detectBiomes) {
        if (!isActive() || targetReached) {
          sendLog("Scan stopped by user.");
          return;
        }
        if (!biomeData) {
          biomeData = await detectBiomesForSeed(seedStr, isActive, config);
        }
        let reqBiomeConfig = null;
        if (reqBiomesActive) {
          for (let i = 0; i < config.requiredBiomes.length; i++) {
            await yieldIfNeeded(i);
            reqBiomeConfig = config.requiredBiomes[i];
            let biomeName, minPatch, maxPatch;
            if (typeof reqBiomeConfig === "object") {
              biomeName = reqBiomeConfig.biome;
              minPatch = reqBiomeConfig.minPatch;
              maxPatch = reqBiomeConfig.maxPatch;
            } else {
              biomeName = reqBiomeConfig;
            }
            // Skip custom biomes here
            if (
              biomeName === "Island" ||
              biomeName === "Encircling Terrain" ||
              biomeName === "Valley"
            ) {
              continue;
            }
            if (!biomeData.uniqueBiomeNames.has(biomeName)) {
              meetsRequiredBiomes = false;
              break;
            }
            const patchesForBiome = biomeData.patches.filter(
              (patch) => patch.biomeName === biomeName
            );
            const validPatchExists = patchesForBiome.some((patch) => {
              let sizeOk = true;
              if (minPatch != null && minPatch !== "") {
                sizeOk = sizeOk && patch.size >= Number(minPatch);
              }
              if (maxPatch != null && maxPatch !== "") {
                const cap = biomeData.gridSize * biomeData.gridSize;
                sizeOk = sizeOk && patch.size <= Math.min(Number(maxPatch), cap);
              }
              return sizeOk;
            });
            if (!validPatchExists) {
              meetsRequiredBiomes = false;
              break;
            }
            /*sendLog(`Valid biome detected: ${biomeName}`);
            patchesForBiome.forEach((patch) => {
              if (
                (minPatch === null || patch.size >= Number(minPatch)) &&
                (maxPatch === null || patch.size <= Number(maxPatch))
              ) {
                sendLog(`- Patch center at (${patch.mainCoord[0]}, ${patch.mainCoord[1]}), size: ${patch.size}`);
              }
            });*/
          }
        }
        const customRequired = config.requiredBiomes
          .map(b => (typeof b === "object" ? b.biome : b))
          .filter(b => b === "Island" || b === "Encircling Terrain" || b === "Valley");
        if (customRequired.includes("Island")) {
          const islands = detectIslands(biomeData);
          let hasValidIsland = false;
          if (islands.length > 0) {
            islands.forEach((island) => {
              const minPatch = reqBiomeConfig.minPatch || 0;
              const maxPatch = reqBiomeConfig.maxPatch || Infinity;
              if (island.size >= minPatch && island.size <= maxPatch) {
                hasValidIsland = true;
                //sendLog(`Detected island: center at (${island.center[0]}, ${island.center[1]}), size: ${island.size}`);
              }
            });
            if (!hasValidIsland) {
              meetsRequiredBiomes = false;
            }
          } else {
            meetsRequiredBiomes = false;
          }
        }
        if (customRequired.includes("Encircling Terrain")) {
          const plateaus = detectEncirclingTerrains(biomeData, config);
          let hasValidPlateau = false;
          if (plateaus.length < 1) {
            meetsRequiredBiomes = false;
          } else {
            const minPatch = reqBiomeConfig.minPatch || 0;
            const maxPatch = reqBiomeConfig.maxPatch || Infinity;
            plateaus.forEach((plat) => {
              if (plat.size >= minPatch && plat.size <= maxPatch) {
                hasValidPlateau = true;
                //sendLog(`Detected encircling terrain: center at (${plat.center[0]}, ${plat.center[1]}), size: ${plat.size}`);
              }
            });
            if (!hasValidPlateau) {
              meetsRequiredBiomes = false;
            }
          }
        }
        if (customRequired.includes("Valley")) {
          const valleys = detectValleys(biomeData, config);
          let hasValidValley = false;
          let hasValleyWithinPatchSize = false;
          if (valleys && valleys.length > 0) {
            valleys.forEach((valley) => {
              if (valley && valley.valleys && valley.valleys.length > 1) {
                hasValidValley = true;
                const minPatch = reqBiomeConfig.minPatch || 0;
                const maxPatch = reqBiomeConfig.maxPatch || Infinity;
                if (valley.valleys.length >= minPatch && valley.valleys.length <= maxPatch) {
                  hasValleyWithinPatchSize = true;
                  if (valley.worldCenter && valley.valleys.length > 2) {
                    //sendLog(`Detected Valley: center at (${valley.worldCenter[0]}, ${valley.worldCenter[1]}), size: ${valley.valleys.length}`);
                  } else {
                    meetsRequiredBiomes = false;
                  }
                }
              }
            });
            if (!hasValidValley || !hasValleyWithinPatchSize) {
              meetsRequiredBiomes = false;
            }
          } else {
            meetsRequiredBiomes = false;
          }
        }
      }
      if (reqClusteredBiomesActive && biomeData) {
        for (const clusterReq of config.clusteredBiomes) {
          const targetBiomes = clusterReq.biomes;
          const minPatch = (clusterReq.minPatch != null && clusterReq.minPatch !== "") ? Number(clusterReq.minPatch) : 1;
          const maxPatch = (clusterReq.maxPatch != null && clusterReq.maxPatch !== "") ? Number(clusterReq.maxPatch) : Infinity;
          const filteredPatches = biomeData.patches.filter(patch => targetBiomes.includes(patch.biomeName));
          const clusters = [];
          const visited = new Set();
          for (let i = 0; i < filteredPatches.length; i++) {
            if (visited.has(i)) continue;
            const cluster = [filteredPatches[i]];
            visited.add(i);
            const queue = [i];
            while (queue.length > 0) {
              const current = queue.shift();
              for (let j = 0; j < filteredPatches.length; j++) {
                if (visited.has(j)) continue;
                if (arePatchesAdjacent(filteredPatches[current], filteredPatches[j])) {
                  cluster.push(filteredPatches[j]);
                  visited.add(j);
                  queue.push(j);
                }
              }
            }
            clusters.push(cluster);
          }
          const validClusters = clusters.filter(cluster => cluster.length >= minPatch && cluster.length <= maxPatch);
          if (validClusters.length === 0) {
            meetsClusteredBiomes = false;
            break;
          } else {
            validClusters.forEach((cluster, index) => {
              const sumCoords = cluster.reduce(
                (acc, patch) => {
                  acc[0] += patch.mainCoord[0];
                  acc[1] += patch.mainCoord[1];
                  return acc;
                },
                [0, 0]
              );
              const centerX = Math.round(sumCoords[0] / cluster.length);
              const centerZ = Math.round(sumCoords[1] / cluster.length);
              /*sendLog(`Valid clustered biome detected (Cluster ${index + 1}):`);
              sendLog(`- Center at (${centerX}, ${centerZ})`);
              sendLog(`- Contains biomes: ${[...new Set(cluster.map(patch => patch.biomeName))].join(', ')}`);
              sendLog(`- Cluster size: ${cluster.length} patches`);*/
            });
          }
        }
      }

      // Final qualification.
      const qualifies =
        (!config.selectedStructures.length || meetsSelectedStructures) &&
        (!reqClusteredStructuresActive || meetsClusteredStructures) &&
        (!reqBiomesActive || meetsRequiredBiomes) &&
        (!reqClusteredBiomesActive || meetsClusteredBiomes);

      if (qualifies) {
        sendLog(`Seed ${seedStr} qualifies`);

        // Log Selected Structures with height and biome info if available
        // Log Selected Structures with height and biome info if available
        if (config.selectedStructures.length > 0) {
          sendLog("Found required structures:");
          config.selectedStructures.forEach(req => {
            const [reqType, reqMin = 1, criteria = {}] = Array.isArray(req) ? req : [req, 1, {}];
            let matches = validStructures.filter(s => s.type === reqType);

            // Apply biome and height filters if criteria exist
            matches = matches.filter(structure => {
              let meetsCriteria = true;

              // Check biome requirement
              if (criteria.biome && biomeData) {
                const isInBiome = isStructureInBiome(structure, biomeData, criteria.biome, config, criteria);
                if (!isInBiome) meetsCriteria = false;
              }

              // Check minimum height
              if (criteria.minHeight != null && biomeData) {
                const surfaceHeight = getSurfaceHeightAtPosition(biomeData, structure.x, structure.z);
                if (surfaceHeight !== undefined && surfaceHeight < criteria.minHeight) {
                  meetsCriteria = false;
                }
              }

              // Check maximum height
              if (criteria.maxHeight != null && biomeData) {
                const surfaceHeight = getSurfaceHeightAtPosition(biomeData, structure.x, structure.z);
                if (surfaceHeight !== undefined && surfaceHeight > criteria.maxHeight) {
                  meetsCriteria = false;
                }
              }

              return meetsCriteria;
            });

            // Only log if minimum structure count is met
            if (matches.length >= reqMin) {
              matches.forEach(structure => {
                let logMsg = `- ${structure.type} at (${structure.x}, ${structure.z})`;

                // Include structure's height if available
                if (structure.y !== undefined) {
                  logMsg += `, Height: ${structure.y}`;
                }

                // Include surface height from biome data if available
                if (biomeData) {
                  const surfaceHeight = getSurfaceHeightAtPosition(biomeData, structure.x, structure.z);
                  if (surfaceHeight !== undefined) {
                    logMsg += `, Biome Surface Height: ${surfaceHeight}`;
                  }

                  if (["Island", "Encircling Terrain", "Valley"].includes(criteria.biome)) {
                    let isInCustomBiome = false;
                    let biomeSize = 0;

                    if (criteria.biome === "Island") {
                      const islands = detectIslands(biomeData);
                      for (const island of islands) {
                        const radius = 8 * Math.sqrt(island.size);
                        const dx = structure.x - island.center[0];
                        const dz = structure.z - island.center[1];
                        const distance = Math.sqrt(dx * dx + dz * dz);
                        if (distance <= radius) {
                          isInCustomBiome = true;
                          biomeSize = island.size;
                          break;
                        }
                      }
                    } else if (criteria.biome === "Encircling Terrain") {
                      const plateaus = detectEncirclingTerrains(biomeData, config);
                      for (const plat of plateaus) {
                        if (
                          structure.x >= plat.worldMinX &&
                          structure.x <= plat.worldMaxX &&
                          structure.z >= plat.worldMinZ &&
                          structure.z <= plat.worldMaxZ
                        ) {
                          isInCustomBiome = true;
                          biomeSize = plat.size;
                          break;
                        }
                      }
                    } else if (criteria.biome === "Valley") {
                      const valleys = detectValleys(biomeData, config);
                      for (const valleyGroup of valleys) {
                        const xs = valleyGroup.allCoords.map(coord => biomeData.worldStartX + coord[0] * 16);
                        const zs = valleyGroup.allCoords.map(coord => biomeData.worldStartZ + coord[1] * 16);
                        const minX = Math.min(...xs);
                        const maxX = Math.max(...xs);
                        const minZ = Math.min(...zs);
                        const maxZ = Math.max(...zs);

                        if (
                          structure.x >= minX &&
                          structure.x <= maxX &&
                          structure.z >= minZ &&
                          structure.z <= maxZ
                        ) {
                          isInCustomBiome = true;
                          biomeSize = valleyGroup.allCoords.length;
                          break;
                        }
                      }
                    }

                    if (isInCustomBiome) {
                      logMsg += `, In Biome: ${criteria.biome} (Yes), Biome Size: ${biomeSize}`;
                    } else {
                      //logMsg += `, In Biome: ${criteria.biome} (No)`;
                    }

                  } else {
                    // Standard biome detection logic
                    const biomePatch = biomeData.patches.find(patch => 
                      patch.biomeName === criteria.biome &&
                      structure.x >= (biomeData.worldStartX + patch.minCellX * 16) &&
                      structure.x <= (biomeData.worldStartX + patch.maxCellX * 16 + 16) &&
                      structure.z >= (biomeData.worldStartZ + patch.minCellY * 16) &&
                      structure.z <= (biomeData.worldStartZ + patch.maxCellY * 16 + 16)
                    );

                    if (biomePatch) {
                      logMsg += `, In Biome: ${criteria.biome} (Yes), Biome Size: ${biomePatch.size}`;
                    } else {
                      //logMsg += `, In Biome: ${criteria.biome} (No)`;
                    }
                  }
                }

                // Send log for every valid structure with biome size
                sendLog(logMsg);
              });
            } else {
              // Explicitly log if structure exists but doesn't meet the required amount
              //sendLog(`- ${reqType} found ${matches.length} times, but minimum required is ${reqMin}`);
            }
          });
        }

        // Log Structure Clusters with extra details
        if (reqClusteredStructuresActive && structureClusters.length > 0) {
          console.log("YAY");

          // Convert invalidClusterCombinations into sets for comparison
          const invalidTypeSets = config.invalidClusterCombinations.map(combo => new Set(combo));

          // Convert structureClusters into sets of unique structure types
          let validClusters = structureClusters.filter(cluster => {
            const clusterSet = new Set(cluster.map(struct => struct.type));
            return !invalidTypeSets.some(invalidSet =>
              clusterSet.size === invalidSet.size && [...clusterSet].every(type => invalidSet.has(type))
            );
          });

          // If all clusters were invalid, skip the seed entirely
          if (validClusters.length === 0) {
            sendLog("Skipping seed due to all clusters being invalid.");
            return;
          }

          validClusters.forEach((cluster, index) => {
            const clusterX = Math.round(cluster.reduce((sum, s) => sum + s.x, 0) / cluster.length);
            const clusterZ = Math.round(cluster.reduce((sum, s) => sum + s.z, 0) / cluster.length);
            const structureTypes = [...new Set(cluster.map(s => s.type))].join(', ');

            sendLog(`Structure Cluster ${index + 1}:`);
            sendLog(`- Center at (${clusterX}, ${clusterZ})`);
            sendLog(`- Includes structures: ${structureTypes}`);
            sendLog(`- Total structures in cluster: ${cluster.length}`);

            // List each structure in the cluster with coordinates and height
            cluster.forEach(structure => {
              let clusterLog = `  - ${structure.type} at (${structure.x}, ${structure.z})`;
              if (structure.y !== undefined) {
                clusterLog += `, Height: ${structure.y}`;
              }
              if (biomeData) {
                const surfaceHeight = getSurfaceHeightAtPosition(biomeData, structure.x, structure.z);
                if (surfaceHeight !== undefined) {
                  clusterLog += `, Biome Surface Height: ${surfaceHeight}`;
                }
              }
            });
          });
        }

        // Log Required Biomes with additional patch details
        if (config.requiredBiomes.length > 0 && biomeData) {
          sendLog("Detected required biomes:");
          config.requiredBiomes.forEach(biomeReq => {
            const biomeName = typeof biomeReq === "object" ? biomeReq.biome : biomeReq;
            const patches = biomeData.patches.filter(patch => patch.biomeName === biomeName);

            patches.forEach(patch => {
              let biomeLog = `- ${biomeName}: Center at (${patch.mainCoord[0]}, ${patch.mainCoord[1]}), Size: ${patch.size}`;

              // Include biome's average height if height data is available
              if (biomeData.heights) {
                const heightsInPatch = patch.cells.map(([x, y]) => {
                  const idx = (y * biomeData.gridSize + x) * 2;
                  return biomeData.heights[idx] | (biomeData.heights[idx + 1] << 8);
                });

                const avgHeight = heightsInPatch.reduce((a, b) => a + b, 0) / heightsInPatch.length;
                biomeLog += `, Avg Height: ${Math.round(avgHeight)}`;
              }

              sendLog(biomeLog);
            });
          });
        }

        // Log Clustered Biomes with detailed info
        if (reqClusteredBiomesActive && biomeData) {
          console.log("Checking for clustered biomes...");

          for (const clusterReq of config.clusteredBiomes) {
            console.log(`Cluster requirements: ${JSON.stringify(clusterReq)}`);

            const targetBiomes = clusterReq.biomes;
            console.log(`Target biomes: ${targetBiomes.join(", ")}`);

            const minPatch = (clusterReq.minPatch != null && clusterReq.minPatch !== "") ? Number(clusterReq.minPatch) : 1;
            const maxPatch = (clusterReq.maxPatch != null && clusterReq.maxPatch !== "") ? Number(clusterReq.maxPatch) : Infinity;

            // Separate standard biomes from custom biomes
            const standardBiomes = targetBiomes.filter(biome => !["Island", "Encircling Terrain", "Valley"].includes(biome));
            const customBiomes = targetBiomes.filter(biome => ["Island", "Encircling Terrain", "Valley"].includes(biome));

            const filteredPatches = biomeData.patches.filter(patch => standardBiomes.includes(patch.biomeName));
            console.log(`Filtered standard biome patches count: ${filteredPatches.length}`);

            // Handle custom biomes detection
            if (customBiomes.includes("Island")) {
              const islands = detectIslands(biomeData);
              islands.forEach(island => {
                filteredPatches.push({
                  biomeName: "Island",
                  mainCoord: island.center,
                  size: island.size,
                  cells: [] // Custom biomes may not have cell data like standard biomes
                });
              });
            }

            if (customBiomes.includes("Encircling Terrain")) {
              const plateaus = detectEncirclingTerrains(biomeData, config);
              plateaus.forEach(plateau => {
                filteredPatches.push({
                  biomeName: "Encircling Terrain",
                  mainCoord: plateau.center,
                  size: plateau.size,
                  cells: []
                });
              });
            }

            if (customBiomes.includes("Valley")) {
              const valleys = detectValleys(biomeData, config);
              valleys.forEach(valley => {
                filteredPatches.push({
                  biomeName: "Valley",
                  mainCoord: valley.worldCenter,
                  size: valley.valleys.length,
                  cells: []
                });
              });
            }

            const clusters = [];
            const visited = new Set();

            for (let i = 0; i < filteredPatches.length; i++) {
              if (visited.has(i)) continue;

              const cluster = [filteredPatches[i]];
              visited.add(i);

              const queue = [i];

              while (queue.length > 0) {
                const current = queue.shift();

                for (let j = 0; j < filteredPatches.length; j++) {
                  if (visited.has(j)) continue;

                  if (arePatchesAdjacent(filteredPatches[current], filteredPatches[j])) {
                    cluster.push(filteredPatches[j]);
                    visited.add(j);
                    queue.push(j);
                  }
                }
              }

              clusters.push(cluster);
            }

            const validClusters = clusters.filter(cluster => cluster.length >= minPatch && cluster.length <= maxPatch);

            if (validClusters.length === 0) {
              console.log("No valid clustered biomes found.");
              meetsClusteredBiomes = false;
              break;
            } else {
              console.log(`Found ${validClusters.length} valid clustered biomes.`);
              validClusters.forEach((cluster, index) => {
                const sumCoords = cluster.reduce(
                  (acc, patch) => {
                    acc[0] += patch.mainCoord[0];
                    acc[1] += patch.mainCoord[1];
                    return acc;
                  },
                  [0, 0]
                );

                const centerX = Math.round(sumCoords[0] / cluster.length);
                const centerZ = Math.round(sumCoords[1] / cluster.length);

                // Log clustered biomes (standard + custom)
                sendLog(`Valid clustered biome detected (Cluster ${index + 1}):`);
                sendLog(`- Center at (${centerX}, ${centerZ})`);
                sendLog(`- Contains biomes: ${[...new Set(cluster.map(patch => patch.biomeName))].join(', ')}`);
                sendLog(`- Cluster size: ${cluster.length} patches`);
              });
            }
          }
        }

        // Log Custom Biomes (Island, Encircling Terrain, Valley)
        if (biomeData && config.requiredBiomes.length > 0) {
          const customRequiredBiomes = config.requiredBiomes
            .map(b => (typeof b === "object" ? b.biome : b))
            .filter(b => ["Island", "Encircling Terrain", "Valley"].includes(b));

          // Handle Islands
          if (customRequiredBiomes.includes("Island")) {
            const islands = detectIslands(biomeData);
            if (islands.length > 0) {
              sendLog("Detected Islands:");
              islands.forEach(island => {
                sendLog(`- Island at (${island.center[0]}, ${island.center[1]}), Size: ${island.size}`);
              });
            }
          }

          // Handle Encircling Terrains
          if (customRequiredBiomes.includes("Encircling Terrain")) {
            const plateaus = detectEncirclingTerrains(biomeData, config);
            if (plateaus.length > 0) {
              sendLog("Detected Encircling Terrains:");
              plateaus.forEach(terrain => {
                sendLog(`- Encircling Terrain at (${terrain.center[0]}, ${terrain.center[1]}), Size: ${terrain.size}`);
              });
            }
          }

          // Handle Valleys
          if (customRequiredBiomes.includes("Valley")) {
            const valleys = detectValleys(biomeData, config);
            if (valleys.length > 0) {
              sendLog("Detected Valleys:");
              valleys.forEach(valleyGroup => {
                sendLog(`- Valley at (${valleyGroup.worldCenter[0]}, ${valleyGroup.worldCenter[1]}), Total Valleys: ${valleyGroup.valleys.length}`);
              });
            }
          }
        }

        // Log Custom Clustered Biomes (if any are set)
        if (reqClusteredBiomesActive && biomeData) {
          config.clusteredBiomes.forEach(clusterReq => {
            const customBiomesInCluster = clusterReq.biomes.filter(b => ["Island", "Encircling Terrain", "Valley"].includes(b));

            if (customBiomesInCluster.includes("Island")) {
              const islands = detectIslands(biomeData);
              if (islands.length > 0) {
                sendLog("Clustered Islands Detected:");
                islands.forEach(island => {
                  sendLog(`- Clustered Island at (${island.center[0]}, ${island.center[1]}), Size: ${island.size}`);
                });
              }
            }

            if (customBiomesInCluster.includes("Encircling Terrain")) {
              const plateaus = detectEncirclingTerrains(biomeData, config);
              if (plateaus.length > 0) {
                sendLog("Clustered Encircling Terrains Detected:");
                plateaus.forEach(terrain => {
                  sendLog(`- Clustered Encircling Terrain at (${terrain.center[0]}, ${terrain.center[1]}), Size: ${terrain.size}`);
                });
              }
            }

            if (customBiomesInCluster.includes("Valley")) {
              const valleys = detectValleys(biomeData, config);
              if (valleys.length > 0) {
                sendLog("Clustered Valleys Detected:");
                valleys.forEach(valleyGroup => {
                  sendLog(`- Clustered Valley at (${valleyGroup.worldCenter[0]}, ${valleyGroup.worldCenter[1]}), Total Valleys: ${valleyGroup.valleys.length}`);
                });
              }
            }
          });
        }
        // Stop if target reached
        foundSeeds++;
        if (config.autoStop && foundSeeds >= config.targetCount) {
          sendLog(`END_OF_SCAN`);
        }
      }
    } catch (error) {
      if (!isActive() || targetReached) {
        sendLog("Scan stopped by user during error handling.");
        return;
      }
      sendLog(`Error processing seed ${seedStr}: ${error}`);
    }
  } // end processSeed
  // Start concurrent workers.
  const workers = [];
  for (let i = 0; i < workerCount; i++) {
    workers.push((async () => {
      while (
        isActive() &&
        !targetReached &&
        currentSeed <= config.seedRangeMax &&
        foundSeeds < config.targetCount
      ) {
        const seed = currentSeed;
        currentSeed = currentSeed + 1n;
        await processSeed(seed);
        seedsScanned++;
        //*const now = Date.now();
        /*if (now - lastLiveUpdate >= 1000) {
          const elapsedSec = Math.floor((now - startTime) / 1000);
          const formattedElapsed = formatElapsedTime(elapsedSec);
          // You can re-enable live logging here if desired:
          // sendLog(`LIVE: ${formattedElapsed}, ${seedsScanned} seeds scanned`);
          lastLiveUpdate = now;
        }*/
      }
    })());
  }
  await Promise.allSettled(workers);
  return {
    seedsScanned, 
    foundSeeds
  };
}

const activeScans = new Map(); // Stores AbortControllers per client

function getClientId(req) {
  return req.ip;
}

// SSE endpoint to stream log messages to the frontend
      app.get("/scan", (req, res) => {
        const clientConfigStr = req.query.config;
        let clientConfig = {};

        if (clientConfigStr) {
          try {
            clientConfig = JSON.parse(decodeURIComponent(clientConfigStr));
            if (clientConfig.startingSeed) clientConfig.startingSeed = BigInt(clientConfig.startingSeed);
            if (clientConfig.seedRangeMin) clientConfig.seedRangeMin = BigInt(clientConfig.seedRangeMin);
            if (clientConfig.seedRangeMax) clientConfig.seedRangeMax = BigInt(clientConfig.seedRangeMax);
            console.log("Client provided configuration:", clientConfig);
          } catch (e) {
            console.error("Error parsing client configuration:", e);
          }
        }

        const localConfig = { ...defaultConfig, ...clientConfig };
        console.log("Using configuration for this session:", localConfig);

        const clientId = getClientId(req);
        const abortController = new AbortController();
        activeScans.set(clientId, abortController);
        const signal = abortController.signal;

        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.flushHeaders();

        const keepAliveInterval = setInterval(() => {
          res.write(":\n\n");
        }, 15000); // Send ping every 15 seconds to ensure connection stays alive

        req.on("close", () => {
          clearInterval(keepAliveInterval);
          if (activeScans.has(clientId)) {
            activeScans.get(clientId).abort();
            activeScans.delete(clientId);
          }
          //res.end();
        });

        function sendLog(msg) {
          console.log("Sending log to frontend:", msg);  // Debugging log
          res.write(`data: ${msg}\n\n`);
          if (res.flush) res.flush();
        }

        console.log("Starting scan for client:", clientId);

        scanSeeds(sendLog, () => !signal.aborted, localConfig)
        .then((result) => {
          if (!signal.aborted) {
            sendLog(`Scan complete. Seeds scanned: ${result.seedsScanned}, seeds found: ${result.foundSeeds}.`);
          } else {
            sendLog("Scan aborted by user.");
          }
          activeScans.delete(clientId);
        })
        .catch(err => {
          console.error(`Error during scan for client ${clientId}:`, err);
          activeScans.delete(clientId);
        });
      });

// Endpoint to stop scan for the specific client
app.post("/stop", (req, res) => {
    const clientId = getClientId(req);

   if (activeScans.has(clientId)) {
    console.log(`Stop request received for client ${clientId}. Aborting scan...`);
     activeScans.get(clientId).abort();
    activeScans.delete(clientId);
          res.status(200).send("Scan stopped successfully for your session.");
} else {
          res.status(400).send("No active scan to stop for your session.");
        }
      });
      // Keep-alive adjustments
const server = http.createServer(app);
server.timeout = 0; // Disable default timeout
server.keepAliveTimeout = 0; // Disable keep-alive timeout
server.headersTimeout = 0; // Disable header timeout

server.timeout = 0;  // Disables the timeout

server.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

      // Optional: Trigger garbage collection periodically if needed (requires --expose-gc flag when running Node.js)
      if (global.gc) {
        setInterval(() => {
          global.gc();
          console.log("Manual garbage collection triggered.");
        }, 60000); // Every 60 seconds
      } else {
        console.log("Garbage collection is not exposed. Run node with --expose-gc if needed.");
      }

      // Minor tweak to async processing to prevent blocking
      async function yieldPeriodically(iteration) {
        if (iteration % 5 === 0) {
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }


