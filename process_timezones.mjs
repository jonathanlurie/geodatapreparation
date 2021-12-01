import fs from 'fs'
import jsonfile from 'jsonfile'
import simplify from 'simplify-js'
import AdmZip from 'adm-zip'

function computeBoundingBox(polygon) {
  let minLat = Infinity
  let minLon = Infinity
  let maxLat = -Infinity
  let maxLon = -Infinity

  for (let i = 0; i < polygon.length; i += 1) {
    const lon = polygon[i][0]
    const lat = polygon[i][1]
    minLat = Math.min(minLat, lat)
    minLon = Math.min(minLon, lon)
    maxLat = Math.max(maxLat, lat)
    maxLon = Math.max(maxLon, lon)
  }

  return [
    [minLon, minLat],
    [maxLon, maxLat]
  ]
}




class NodeBVH {
  constructor(polygonList) {
    this.p = polygonList // list of polygons to share with sub nodes
    this.l = null // left child box
    this.r = null // right child box
    this.b = null // bounding box of this node
    this.init()
  }


  init() {
    // compute lengthX
    let minX = +Infinity
    let maxX = -Infinity
    let minY = +Infinity
    let maxY = -Infinity

    this.p.forEach(pol => {
      minX = Math.min(minX, pol.b[0][0])
      maxX = Math.max(maxX, pol.b[1][0])
      minY = Math.min(minY, pol.b[0][1])
      maxY = Math.max(maxY, pol.b[1][1])
    })

    this.b = [
      [minX, minY],
      [maxX, maxY],
    ]

    if (this.p.length <= 2) {
      delete this.r
      delete this.l
      return
    }

    const indexLonguestAxis = this.indexLonguestAxis
    const sortedPolygonList = this.p.slice()
    sortedPolygonList.sort((a, b) => a.mp[indexLonguestAxis] > b.mp[indexLonguestAxis] ? 1 : -1)

    // create left and right sub box
    const splitIndex = Math.floor(sortedPolygonList.length / 2)
    this.l = new NodeBVH(sortedPolygonList.slice(0, splitIndex), this.level)
    this.r = new NodeBVH(sortedPolygonList.slice(splitIndex), this.level)

    // reset local polygonlist
    delete this.p
  }


  get sizeX() {
    return this.b[1][0] - this.b[0][0]
  }


  get sizeY() {
    return this.b[1][1] - this.b[0][1]
  }


  get indexLonguestAxis() {
    const sizeX = this.sizeX
    const sizeY = this.sizeY
    return sizeX >= sizeY ? 0 : 1
  }
}



function writePolygonBuffer(id, index, geojsonPolygon) {
  const encodedId = encodeURIComponent(id)
  try {
    fs.mkdirSync(`timezone_data/output/tz_bin/${encodedId}`)
  } catch(e) {}
  const flatPolygon = new Float32Array(geojsonPolygon.flat())
  const buf = Buffer.from(flatPolygon.buffer)
  fs.writeFileSync(`timezone_data/output/tz_bin/${encodedId}/${index}.bin`, buf)
}


function main() {
  const SIMPLIFICATION_TOLERANCE = 0.00001 ** 0.5

  // reading the zipped json because the unzipped one is too large for github (100MB+)
  const timezoneGeojson = JSON.parse((new AdmZip('./timezone_data/input/tz-combined-with-oceans.json.zip')).readAsText('tz-combined-with-oceans.json'))

  try {
    fs.mkdirSync('timezone_data/output/tz_bin')
  } catch(e) {}

  // this list is what is going to fuel the creation of the BVH
  const polygonSummaryList = []
  
  for (let i = 0; i < timezoneGeojson.features.length; i += 1) {
    let polygonCounter = 0 // some polygons have a 0 area so we cannot rely solely in i
    const feature = timezoneGeojson.features[i]
    const geometry = feature.geometry
    const id = feature.properties.tzid
    const geometryType = geometry.type

    if (geometryType !== 'Polygon' && geometryType !== 'MultiPolygon') {
      continue
    }

    // treating all polygons as if they were multipolygons
    // because it makes the next part easier
    const polygons = geometryType === 'Polygon' ? [geometry.coordinates[0]] : geometry.coordinates.map(el => el[0])

    for (let p = 0; p < polygons.length; p += 1) {
      const simplifyCompliantPolygon = polygons[p].map(pt => {
        return { x: pt[0], y: pt[1] }
      })

      const polygon = simplify(simplifyCompliantPolygon, SIMPLIFICATION_TOLERANCE).map(pt => [pt.x, pt.y])
      const bbox = computeBoundingBox(polygon)

      // if area size is 0, no polygon
      if (bbox[0][0] === bbox[1][0] || bbox[0][1] === bbox[1][1]) {
        continue
      }
      
      // writing polygon buffer on disc
      writePolygonBuffer(id, polygonCounter, polygon)

      // the property names are short/unreadable because this is going to be JSON serialized
      // and we want this payload to be as small as possible
      polygonSummaryList.push({
        tz: id,  // id of the timezone
        i: polygonCounter, // index of the polygon (to cover the multipolygon case)
        b: bbox, // bounding box
        mp: [(bbox[0][0] + bbox[1][0]) / 2, (bbox[0][1] + bbox[1][1]) / 2], // middle point for the bounding box
      })

      polygonCounter += 1
    }
  }

  // compute the BVH
  const rooBvhNode = new NodeBVH(polygonSummaryList)
  jsonfile.writeFileSync('timezone_data/output/bvh.json', rooBvhNode)
}

main()