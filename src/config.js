import { gcj02ToLocal, localToGcj02 } from "./geo.js";

export const VILLAGE_CENTER = {
  lat: 25.112482,
  lon: 118.902872,
};

export const OLD_STREET_CENTER = {
  lat: 25.124914,
  lon: 118.905969,
};

export const YUNCHENG_CENTER = {
  lat: 25.131738,
  lon: 118.920342,
};

const point = (lat, lon) => gcj02ToLocal(lat, lon);
// The AMap search pin for "山腰老街" sits about 28 m off the traced centreline.
// Keep the pin as historical context, but anchor the walkable POI to the road.
const oldStreet = { x: 126.7767401, z: -772.2752686 };
const museum = point(25.120885, 118.90118);
const watchTower = point(25.11717, 118.90503);
const longjianTemple = point(25.11406, 118.90038);
const changfang = point(25.115286, 118.90301);
const houlou = point(25.117264, 118.904874);

export const DISTRICTS = [
  { id: "oldstreet", name: "山腰老街", x: oldStreet.x, z: oldStreet.z, accent: "#d6b371" },
  { id: "shiqiao", name: "石桥", x: museum.x - 5, z: museum.z + 40, accent: "#b8563f" },
  { id: "houlou", name: "后楼", x: houlou.x, z: houlou.z, accent: "#8c7453" },
  { id: "mianqianshan", name: "面前山", x: -330, z: 195, accent: "#6f8c68" },
  { id: "changfang", name: "长房", x: changfang.x, z: changfang.z, accent: "#d0a04a" },
  { id: "sanluo", name: "三落", x: 180, z: 420, accent: "#9b6645" },
  { id: "saltpan", name: "埭港盐田", x: 690, z: 1120, accent: "#88aaa3" },
];

export const POIS = [
  {
    id: "oldstreet",
    index: "01",
    kicker: "泉港商贸旧街",
    title: "山腰老街",
    shortTitle: "山腰老街",
    description:
      "山腰老街是旧山腰街道贯穿南北的商贸街。公开地方志记其店铺连片、商贾云集；沿街仍以两三层石构与砖混店铺、窄门面、遮雨棚和密集电线为最鲜明特征。",
    meta: "真实街位 · 建筑轮廓与街巷走向对位",
    position: [oldStreet.x, 3.2, oldStreet.z],
    camera: [156, 8.2, -859],
    target: [87, 2.3, -669],
    focusRadius: 60,
    district: "oldstreet",
  },
  {
    id: "museum",
    index: "02",
    kicker: "省级文物保护单位",
    title: "庄氏古民居 · 小三房",
    shortTitle: "庄氏古民居",
    description:
      "庄氏古民居又称小三房，位于埭港石桥自然村。地方资料常记其始建于清乾隆五十二年（约 1786 年）；白石墙基、红砖墙体、燕尾脊与院落轴线构成当地重要的宗族建筑群。",
    meta: "埭港村石桥 · 清代建筑群",
    position: [museum.x, 4.4, museum.z],
    camera: [museum.x + 76, 42, museum.z + 84],
    target: [museum.x, 4, museum.z],
    focusRadius: 55,
    district: "shiqiao",
  },
  {
    id: "longjiangong",
    index: "03",
    kicker: "明代古建",
    title: "龙见宫 · 白石港",
    shortTitle: "龙见宫",
    description:
      "龙见宫又称新宫，始建于明末，坐落在埭港村白石港。宫、戏台与廊阁共同构成村落公共文化空间。",
    meta: "区级文物保护 · 白石港",
    position: [longjianTemple.x, 3.4, longjianTemple.z],
    camera: [longjianTemple.x + 58, 32, longjianTemple.z + 72],
    target: [longjianTemple.x, 3, longjianTemple.z],
    focusRadius: 45,
    district: "changfang",
  },
  {
    id: "watchtower",
    index: "04",
    kicker: "市级文物保护单位",
    title: "望海楼",
    shortTitle: "望海楼",
    description:
      "望海楼位于埭港后楼。官方村情将其列为市级文物保护单位；后楼同时是革命老区据点村，1949 年山腰盐署警大队起义即在此策动。",
    meta: "埭港后楼 · 市级文物保护",
    position: [watchTower.x, 7.4, watchTower.z],
    camera: [watchTower.x + 42, 27, watchTower.z + 48],
    target: [watchTower.x, 6, watchTower.z],
    focusRadius: 38,
    district: "houlou",
  },
  {
    id: "changfang",
    index: "05",
    kicker: "埭港村部所在地",
    title: "长房 · 埭港生活",
    shortTitle: "长房",
    description:
      "长房是埭港六个自然村之一，也是埭港村部所在地。官方村情记载这一带以海蛎、青蛏养殖为代表；附近港汊和滩涂是理解村落生计的重要线索。",
    meta: "长房 888 号 · 村部所在地",
    position: [changfang.x, 2.2, changfang.z],
    camera: [changfang.x + 84, 38, changfang.z + 82],
    target: [changfang.x, 2, changfang.z],
    focusRadius: 42,
    district: "changfang",
  },
  {
    id: "saltpan",
    index: "06",
    kicker: "海岸盐业生产景观",
    title: "山腰盐场 · 埭港工区",
    shortTitle: "埭港盐田",
    description:
      "埭港村东临滩涂盐田。1942 年，山腰盐场的后埭、后港盐务所合并为埭港盐务所；其后历经场务所、工区等建制，盐田与村落生活长期交织。",
    meta: "埭港村东 · 卫星影像拍摄时点",
    position: [690, 2.4, 1120],
    camera: [430, 82, 720],
    target: [710, 1.2, 1120],
    focusRadius: 180,
    district: "saltpan",
  },
];

// Centerlines digitised by tracing the public Gaode map at zoom 17. This
// establishes street topology and approximate alignment; architectural
// footprints come from GlobalBuildingAtlas rather than this trace.
const MAP_CENTER = OLD_STREET_CENTER;
const MAP_CENTER_PIXEL = [900, 900];
const METRES_PER_PIXEL = 1.0813262836;
const metresPerDegreeLon = 111320 * Math.cos((MAP_CENTER.lat * Math.PI) / 180);
const metresPerDegreeLat = 110574;

function pixelPoint([px, py]) {
  const lat =
    MAP_CENTER.lat -
    ((py - MAP_CENTER_PIXEL[1]) * METRES_PER_PIXEL) / metresPerDegreeLat;
  const lon =
    MAP_CENTER.lon +
    ((px - MAP_CENTER_PIXEL[0]) * METRES_PER_PIXEL) / metresPerDegreeLon;
  return gcj02ToLocal(lat, lon);
}

function pathFromPixels(points) {
  return points.map(([x, y]) => {
    const projected = pixelPoint([x, y]);
    return [projected.x, projected.z];
  });
}

export const ROAD_PATHS = [
  {
    id: "shan-yao-old-street",
    name: "山腰老街",
    width: 5.8,
    points: pathFromPixels([
      [886, 0], [890, 115], [879, 238], [865, 348], [893, 451],
      [929, 520], [966, 622], [974, 742], [939, 871], [900, 970],
      [864, 1075], [817, 1188], [778, 1280], [735, 1392],
      [699, 1508], [661, 1638], [618, 1760], [586, 1800],
    ]),
  },
  {
    id: "zhongxing-street",
    name: "中兴街",
    width: 10.8,
    points: pathFromPixels([
      [0, 831], [250, 828], [500, 827], [760, 825], [1010, 824],
      [1260, 823], [1510, 821], [1800, 817],
    ]),
  },
  {
    id: "jinshan-street",
    name: "金山街",
    width: 9.6,
    points: pathFromPixels([
      [1380, 0], [1378, 240], [1377, 485], [1376, 730],
      [1372, 980], [1373, 1230], [1381, 1477], [1390, 1800],
    ]),
  },
  {
    id: "qixing-street",
    name: "七星街",
    width: 7.2,
    points: pathFromPixels([
      [1608, 301], [1600, 530], [1603, 790], [1595, 1060],
      [1598, 1320], [1591, 1590], [1600, 1800],
    ]),
  },
  {
    id: "shan-yao-street",
    name: "山腰街",
    width: 7.4,
    points: pathFromPixels([
      [613, 0], [602, 160], [595, 320], [610, 455], [647, 590],
      [631, 738], [590, 879], [547, 1020], [501, 1151],
      [451, 1273], [391, 1396], [331, 1511], [266, 1612],
      [188, 1722], [112, 1800],
    ]),
  },
  {
    id: "nan-shan-road",
    name: "南山路",
    width: 8.2,
    points: pathFromPixels([
      [0, 178], [220, 244], [429, 337], [626, 472],
      [742, 657], [760, 826], [731, 1010], [656, 1163],
      [558, 1308], [468, 1463], [392, 1609], [308, 1800],
    ]),
  },
  {
    id: "xuefu-road",
    name: "学府路",
    width: 8.8,
    points: pathFromPixels([
      [1105, 816], [1122, 1010], [1138, 1212], [1148, 1394],
      [1133, 1581], [1096, 1766],
    ]),
  },
  {
    id: "old-town-north",
    name: "旧镇北巷",
    width: 4.2,
    points: pathFromPixels([
      [716, 0], [728, 203], [751, 408], [760, 610],
      [763, 816], [790, 1010], [858, 1160],
    ]),
  },
  {
    id: "old-town-west",
    name: "老巷",
    width: 3.4,
    points: pathFromPixels([
      [263, 0], [271, 224], [294, 426], [351, 582],
      [445, 702], [559, 809], [694, 927],
    ]),
  },
  {
    id: "old-town-east",
    name: "锦山巷",
    width: 3.5,
    points: pathFromPixels([
      [1158, 0], [1147, 250], [1128, 460], [1098, 650],
      [1035, 825], [994, 991], [1004, 1172], [1041, 1350],
    ]),
  },
  {
    id: "min-nan-alley",
    name: "下街",
    width: 3.2,
    points: pathFromPixels([
      [489, 432], [594, 546], [701, 659], [810, 745],
      [932, 827], [1051, 951], [1131, 1125],
    ]),
  },
  {
    id: "village-link",
    name: "埭港路",
    width: 5.2,
    points: pathFromPixels([
      [1088, 828], [1055, 1042], [1004, 1232], [950, 1398],
      [882, 1546], [801, 1682], [696, 1800],
    ]),
  },
];

export const CAMERA_PRESETS = {
  overview: {
    position: [460, 620, 700],
    target: [0, 2, -420],
  },
  oldStreet: {
    position: [156, 8.2, -859],
    target: [87, 2.3, -669],
  },
  intro: [
    { position: [460, 620, 700], target: [0, 2, -420], duration: 7 },
    { position: [310, 145, 170], target: [10, 2, -420], duration: 7 },
    { position: [190, 62, -580], target: [82, 2, -704], duration: 7 },
    { position: [80, 48, 350], target: [-60, 1, 40], duration: 7 },
  ],
};

export function poiGcjCoordinate(x, z) {
  return localToGcj02(x, z);
}
