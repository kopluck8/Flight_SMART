// Frame tiruan yang meniru keluaran dji-log-parser-js untuk pengujian tanpa log asli.

export function fakeFrames({ startMs = Date.UTC(2026, 9, 26, 1, 0, 0), seconds = 120, hz = 10, lat0 = -8.2865, lon0 = 118.1738, photoEvery = 20 } = {}) {
  const frames = [];
  const n = seconds * hz;
  for (let i = 0; i < n; i++) {
    const t = i / hz;
    const gps = i >= 5; // beberapa frame awal belum dapat GPS
    const isPhoto = photoEvery > 0 && t > 10 && Math.abs((t % photoEvery)) < 1e-9;
    frames.push({
      custom: { dateTime: new Date(startMs + i * (1000 / hz)).toISOString() },
      osd: {
        flyTime: t,
        latitude: gps ? lat0 + t * 2e-5 : 0,
        longitude: gps ? lon0 + Math.sin(t / 20) * 3e-4 : 0,
        height: Math.min(t * 2, 80),
        vpsHeight: 0,
        altitude: 240 + Math.min(t * 2, 80),
        xSpeed: 3, ySpeed: 1, zSpeed: 0.2,
        pitch: 1, roll: 0, yaw: 45,
        flycState: "GPSAtti", isOnGround: t < 2, isMotorOn: true,
        gpsNum: 15, gpsLevel: 5,
      },
      gimbal: { pitch: -90, yaw: 45 },
      camera: { isPhoto, isVideo: false },
      rc: { aileron: 0, elevator: 0, throttle: 0, rudder: 0 },
      battery: { chargeLevel: 100 - Math.floor(t / 10), voltage: 15.2, current: -8.1, temperature: 31 },
      home: { latitude: lat0, longitude: lon0, altitude: 240 },
      app: { tip: "", warn: "" },
    });
  }
  return frames;
}

export function fakeParserFactory(specByContent) {
  return (bytes) => {
    const key = new TextDecoder().decode(bytes).trim();
    const spec = specByContent[key];
    if (!spec) throw new Error("Parse error: bad magic at 0x0");
    return {
      version: spec.version ?? 12,
      details: { aircraftName: "Mavic 2 Enterprise", productType: "Mavic2Enterprise", aircraftSn: "SN123", startTime: new Date(spec.startMs).toISOString(), totalTime: spec.seconds, city: "Dompu", area: "NTB" },
      async fetchKeychains(key) { if (key !== "good-key") throw new Error("Invalid api key"); return [[]]; },
      frames() { return fakeFrames(spec); },
    };
  };
}
