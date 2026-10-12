var s=`(function() {
  "use strict";
  const MAX_BYTES = 16 * 1024 * 1024;
  const BRANDS = /* @__PURE__ */ new Set([
    "isom",
    "iso2",
    "iso3",
    "iso4",
    "iso5",
    "iso6",
    "mp41",
    "mp42",
    "avc1",
    "3gp4",
    "3gp5",
    "3gp6",
    "3gp7",
    "3gp8",
    "3gp9",
    "3ge6",
    "3ge7",
    "3gg6"
  ]);
  const FORBIDDEN = /* @__PURE__ */ new Set([
    "moof",
    "mvex",
    "sinf",
    "schi",
    "tenc",
    "pssh",
    "senc",
    "saiz",
    "saio",
    "encv",
    "enca",
    "wave"
  ]);
  const OTHER_VIDEO = /* @__PURE__ */ new Set(["hvc1", "hev1", "vp09", "vp08", "av01", "mp4v", "s263"]);
  const OTHER_AUDIO = /* @__PURE__ */ new Set([
    ".mp3",
    "mp3 ",
    "ac-3",
    "ec-3",
    "Opus",
    "alac",
    "fLaC",
    "samr",
    "sawb",
    "lpcm",
    "sowt",
    "twos"
  ]);
  function inspectWhatsAppVideo(buffer) {
    try {
      if (buffer.byteLength === 0 || buffer.byteLength > MAX_BYTES) return "unreadable";
      return new Inspector(new DataView(buffer)).inspect();
    } catch {
      return "unreadable";
    }
  }
  class Inspector {
    constructor(view) {
      this.budget = 4096;
      this.videoCount = 0;
      this.audioCount = 0;
      this.unsupported = false;
      this.trackIds = /* @__PURE__ */ new Set();
      this.view = view;
    }
    require(ok) {
      if (!ok) throw new Error("Unrecognized media metadata");
    }
    spend() {
      this.require(--this.budget >= 0);
    }
    has(start, count, end) {
      this.require(start >= 0 && count >= 0 && start + count <= end);
    }
    u8(p) {
      return this.view.getUint8(p);
    }
    u16(p) {
      return this.view.getUint16(p);
    }
    u32(p) {
      return this.view.getUint32(p);
    }
    text(p) {
      return String.fromCharCode(this.u8(p), this.u8(p + 1), this.u8(p + 2), this.u8(p + 3));
    }
    full(box, minimum) {
      this.has(box.data, minimum, box.end);
      this.require(this.u32(box.data) === 0);
      return box.data + 4;
    }
    scan(start, end, visit, top = false) {
      let p = start;
      while (p < end) {
        this.spend();
        this.has(p, 8, end);
        let size = this.u32(p);
        const type = this.text(p + 4);
        let header = 8;
        if (size === 1) {
          this.has(p, 16, end);
          size = this.u32(p + 8) * 4294967296 + this.u32(p + 12);
          header = 16;
          this.require(Number.isSafeInteger(size));
        } else if (size === 0) {
          this.require(top);
          size = end - p;
        }
        if (type === "uuid") header += 16;
        this.require(size >= header && size <= end - p);
        this.require(!FORBIDDEN.has(type));
        visit({ type, start: p, data: p + header, end: p + size });
        p += size;
      }
      this.require(p === end);
    }
    selected(parent, names, start = parent.data) {
      const result = /* @__PURE__ */ new Map();
      this.scan(start, parent.end, (box) => {
        if (!names.includes(box.type)) return;
        this.require(!result.has(box.type));
        result.set(box.type, box);
      });
      return result;
    }
    needed(boxes, name) {
      const box = boxes.get(name);
      this.require(box);
      return box;
    }
    inspect() {
      let ftyp;
      let moov;
      let mediaBytes = 0;
      this.scan(
        0,
        this.view.byteLength,
        (box) => {
          if (box.type === "ftyp") {
            this.require(!ftyp);
            ftyp = box;
          }
          if (box.type === "moov") {
            this.require(!moov);
            moov = box;
          }
          if (box.type === "mdat") mediaBytes += box.end - box.data;
        },
        true
      );
      this.require(ftyp && moov && mediaBytes > 0);
      this.brands(ftyp);
      let mvhd = false;
      this.scan(moov.data, moov.end, (box) => {
        if (box.type === "mvhd") {
          this.require(!mvhd);
          this.header(box, "mvhd");
          mvhd = true;
        }
        if (box.type === "trak") this.track(box);
      });
      this.require(mvhd && this.videoCount > 0);
      return this.unsupported || this.videoCount !== 1 || this.audioCount > 1 ? "unsupported" : "valid";
    }
    brands(box) {
      this.has(box.data, 8, box.end);
      this.require((box.end - box.data) % 4 === 0);
      this.require(BRANDS.has(this.text(box.data)));
      for (let p = box.data + 8; p < box.end; p += 4) {
        this.spend();
        this.require(this.text(p) !== "qt  ");
      }
    }
    header(box, kind) {
      this.has(box.data, 4, box.end);
      const version = this.u8(box.data);
      this.require(version === 0 || version === 1);
      const minimum = kind === "mvhd" ? 100 : kind === "tkhd" ? 84 : 24;
      this.has(box.data, minimum + (version === 1 ? 12 : 0), box.end);
      const value = this.u32(box.data + (version === 1 ? 20 : 12));
      this.require(value > 0);
      return value;
    }
    track(box) {
      const fields = this.selected(box, ["tkhd", "mdia"]);
      const id = this.header(this.needed(fields, "tkhd"), "tkhd");
      this.require(!this.trackIds.has(id));
      this.trackIds.add(id);
      const mdia = this.selected(this.needed(fields, "mdia"), ["mdhd", "hdlr", "minf"]);
      this.header(this.needed(mdia, "mdhd"), "mdhd");
      const handler = this.needed(mdia, "hdlr");
      const hp = this.full(handler, 24);
      const kind = this.text(hp + 4);
      this.require(kind === "vide" || kind === "soun");
      if (kind === "vide") this.videoCount++;
      else this.audioCount++;
      const minf = this.selected(this.needed(mdia, "minf"), ["stbl"]);
      const stbl = this.selected(this.needed(minf, "stbl"), ["stsd"]);
      const stsd = this.needed(stbl, "stsd");
      const p = this.full(stsd, 8);
      this.require(this.u32(p) === 1);
      let entries = 0;
      this.scan(p + 4, stsd.end, (entry) => {
        this.require(++entries === 1);
        this.sampleEntry(entry, kind);
      });
      this.require(entries === 1);
    }
    sampleEntry(box, kind) {
      const size = kind === "vide" ? 78 : 28;
      this.has(box.data, size, box.end);
      this.require(this.u16(box.data + 6) > 0);
      if (kind === "soun") this.require(this.u16(box.data + 8) === 0);
      const configs = this.selected(box, ["avcC", "esds", "hvcC", "vpcC", "av1C"], box.data + size);
      if (kind === "vide") {
        if (OTHER_VIDEO.has(box.type)) {
          this.unsupported = true;
          return;
        }
        this.require(box.type === "avc1" || box.type === "avc3");
        this.require(configs.size === 1);
        this.avc(this.needed(configs, "avcC"));
      } else {
        if (OTHER_AUDIO.has(box.type)) {
          this.unsupported = true;
          return;
        }
        this.require(box.type === "mp4a" && configs.size === 1);
        this.aac(this.needed(configs, "esds"));
      }
    }
    avc(box) {
      let p = box.data;
      this.has(p, 7, box.end);
      this.require(this.u8(p) === 1);
      const profile = this.u8(p + 1);
      this.require((this.u8(p + 4) & 252) === 252 && (this.u8(p + 4) & 3) !== 2);
      this.require((this.u8(p + 5) & 224) === 224);
      const spsCount = this.u8(p + 5) & 31;
      this.require(spsCount > 0);
      p += 6;
      const units = (count, type, minimum) => {
        for (let i = 0; i < count; i++) {
          this.spend();
          this.has(p, 2, box.end);
          const length = this.u16(p);
          p += 2;
          this.require(length >= minimum);
          this.has(p, length, box.end);
          this.require((this.u8(p) & 159) === type && (this.u8(p) & 96) !== 0);
          if (type === 7) {
            this.require(
              this.u8(p + 1) === profile && this.u8(p + 2) === this.u8(box.data + 2) && this.u8(p + 3) === this.u8(box.data + 3)
            );
          }
          p += length;
        }
      };
      units(spsCount, 7, 4);
      this.has(p, 1, box.end);
      const ppsCount = this.u8(p++);
      this.require(ppsCount > 0);
      units(ppsCount, 8, 2);
      if (p < box.end) {
        this.require([100, 110, 122, 144].includes(profile));
        this.has(p, 4, box.end);
        this.require((this.u8(p) & 252) === 252);
        this.require((this.u8(p + 1) & 248) === 248 && (this.u8(p + 1) & 7) <= 6);
        this.require((this.u8(p + 2) & 248) === 248 && (this.u8(p + 2) & 7) <= 6);
        const extensions = this.u8(p + 3);
        p += 4;
        units(extensions, 13, 2);
      }
      this.require(p === box.end);
    }
    descriptor(p, end) {
      this.spend();
      this.has(p, 2, end);
      const tag = this.u8(p++);
      let length = 0;
      let done = false;
      for (let i = 0; i < 4; i++) {
        this.has(p, 1, end);
        const b = this.u8(p++);
        length = length * 128 + (b & 127);
        if (!(b & 128)) {
          done = true;
          break;
        }
      }
      this.require(done);
      this.has(p, length, end);
      return { tag, data: p, end: p + length };
    }
    aac(box) {
      const start = this.full(box, 6);
      const es = this.descriptor(start, box.end);
      this.require(es.tag === 3 && es.end === box.end);
      this.has(es.data, 3, es.end);
      this.require((this.u8(es.data + 2) & 224) === 0);
      let config;
      let sl = false;
      for (let p = es.data + 3; p < es.end; ) {
        const child = this.descriptor(p, es.end);
        if (child.tag === 4) {
          this.require(!config);
          config = child;
        } else if (child.tag === 6) {
          this.require(!sl && child.end - child.data === 1 && this.u8(child.data) === 2);
          sl = true;
        } else this.require(false);
        p = child.end;
      }
      this.require(config && sl);
      this.has(config.data, 13, config.end);
      const stream = this.u8(config.data + 1);
      this.require(stream >>> 2 === 5 && (stream & 2) === 0);
      const oti = this.u8(config.data);
      let asc;
      for (let p = config.data + 13; p < config.end; ) {
        const child = this.descriptor(p, config.end);
        this.require(child.tag === 5 && !asc);
        asc = child;
        p = child.end;
      }
      if ([105, 107, 165, 166].includes(oti)) {
        this.unsupported = true;
        return;
      }
      this.require(oti === 64 && asc);
      this.asc(asc);
    }
    asc(config) {
      let bit = config.data * 8;
      const end = config.end * 8;
      const bits = (count) => {
        this.require(bit + count <= end);
        let value = 0;
        for (let i = 0; i < count; i++, bit++)
          value = value * 2 + (this.u8(bit >>> 3) >>> 7 - (bit & 7) & 1);
        return value;
      };
      let aot = bits(5);
      if (aot === 31) aot = 32 + bits(6);
      if ([32, 33, 34].includes(aot)) {
        this.unsupported = true;
        return;
      }
      this.require(aot === 2);
      const frequency = bits(4);
      if (frequency === 15) this.require(bits(24) > 0);
      else this.require(frequency <= 12);
      const channels = bits(4);
      this.require(channels >= 1 && channels <= 7);
      bits(1);
      this.require(bits(1) === 0 && bits(1) === 0);
      this.require(end - bit < 8);
      if (bit < end) this.require(bits(end - bit) === 0);
    }
  }
  const MEBIBYTE = 1024 * 1024;
  const WHATSAPP_CAMS_DEMO_VIDEO_MAX_SIZE_BYTES = 16 * MEBIBYTE;
  const WHATSAPP_CAMS_DEMO_MEDIA_RULES = Object.freeze({
    jpg: { kind: "image", mimeType: "image/jpeg", maxSizeBytes: 5 * MEBIBYTE },
    jpeg: { kind: "image", mimeType: "image/jpeg", maxSizeBytes: 5 * MEBIBYTE },
    png: { kind: "image", mimeType: "image/png", maxSizeBytes: 5 * MEBIBYTE },
    mp4: {
      kind: "video",
      mimeType: "video/mp4",
      maxSizeBytes: WHATSAPP_CAMS_DEMO_VIDEO_MAX_SIZE_BYTES
    },
    "3gp": {
      kind: "video",
      mimeType: "video/3gpp",
      maxSizeBytes: WHATSAPP_CAMS_DEMO_VIDEO_MAX_SIZE_BYTES
    },
    txt: { kind: "document", mimeType: "text/plain", maxSizeBytes: 50 * MEBIBYTE },
    pdf: { kind: "document", mimeType: "application/pdf", maxSizeBytes: 50 * MEBIBYTE },
    ppt: {
      kind: "document",
      mimeType: "application/vnd.ms-powerpoint",
      maxSizeBytes: 50 * MEBIBYTE
    },
    doc: { kind: "document", mimeType: "application/msword", maxSizeBytes: 50 * MEBIBYTE },
    xls: {
      kind: "document",
      mimeType: "application/vnd.ms-excel",
      maxSizeBytes: 50 * MEBIBYTE
    },
    docx: {
      kind: "document",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      maxSizeBytes: 50 * MEBIBYTE
    },
    pptx: {
      kind: "document",
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      maxSizeBytes: 50 * MEBIBYTE
    },
    xlsx: {
      kind: "document",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      maxSizeBytes: 50 * MEBIBYTE
    }
  });
  Object.freeze({
    maxCount: 1,
    strictAccept: true,
    accept: Object.keys(WHATSAPP_CAMS_DEMO_MEDIA_RULES).map((extension) => \`.\${extension}\`).join(",")
  });
  const workerScope = self;
  workerScope.onmessage = async (event) => {
    workerScope.onmessage = null;
    const file = event.data;
    if (!(file instanceof Blob) || file.size === 0 || file.size > WHATSAPP_CAMS_DEMO_VIDEO_MAX_SIZE_BYTES) {
      workerScope.postMessage("unreadable");
      return;
    }
    if (typeof file.arrayBuffer !== "function") {
      workerScope.postMessage("check-failed");
      return;
    }
    try {
      const buffer = await file.arrayBuffer();
      workerScope.postMessage(inspectWhatsAppVideo(buffer));
    } catch {
      workerScope.postMessage("unreadable");
    }
  };
})();
//# sourceMappingURL=whatsappVideo.worker-Cx7AgGWu.js.map
`,i=typeof self<"u"&&self.Blob&&new Blob(["(self.URL || self.webkitURL).revokeObjectURL(self.location.href);",s],{type:"text/javascript;charset=utf-8"});function r(t){let n;try{if(n=i&&(self.URL||self.webkitURL).createObjectURL(i),!n)throw"";const e=new Worker(n,{name:t?.name});return e.addEventListener("error",()=>{(self.URL||self.webkitURL).revokeObjectURL(n)}),e}catch{return new Worker("data:text/javascript;charset=utf-8,"+encodeURIComponent(s),{name:t?.name})}}export{r as default};
