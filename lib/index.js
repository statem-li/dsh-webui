import { createRequire } from "node:module";
import path, { basename, join } from "node:path";
import fs, { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { execFile, spawn } from "node:child_process";
import { URL as URL$1, fileURLToPath } from "node:url";
import os, { homedir } from "node:os";
import net from "node:net";
import crypto$1, { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
//#region ../../deepseek-harness/vendor/cosmokit/lib/index.js
/** Return true when a value is `null` or `undefined`. */
function isNullable(value) {
	return value === null || value === void 0;
}
/** Return true for non-array object values. */
function isPlainObject$1(data) {
	return data && typeof data === "object" && !Array.isArray(data);
}
/** Filter object entries and return a new object. */
function filterKeys(object, filter) {
	return Object.fromEntries(Object.entries(object).filter(([key, value]) => filter(key, value)));
}
/** Map object values while preserving the original key set. */
function mapValues(object, transform) {
	return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, transform(value, key)]));
}
/** Pick selected keys from an object, optionally including `undefined` values. */
function pick(source, keys, forced) {
	if (!keys) return { ...source };
	const result = {};
	for (const key of keys) if (forced || source[key] !== void 0) result[key] = source[key];
	return result;
}
/** Define a non-enumerable writable property and return the object. */
function defineProperty(object, key, value) {
	return Object.defineProperty(object, key, {
		writable: true,
		value,
		enumerable: false
	});
}
/** Test values using `instanceof` with a `toStringTag` fallback. */
function is(type, value) {
	if (arguments.length === 1) return (value) => is(type, value);
	return type in globalThis && value instanceof globalThis[type] || Object.prototype.toString.call(value).slice(8, -1) === type;
}
function isArrayBufferLike(value) {
	return is("ArrayBuffer", value) || is("SharedArrayBuffer", value);
}
function isArrayBufferSource(value) {
	return isArrayBufferLike(value) || ArrayBuffer.isView(value);
}
/** Binary source detection and base64/hex conversion helpers. */
var Binary;
(function(Binary) {
	Binary.is = isArrayBufferLike;
	Binary.isSource = isArrayBufferSource;
	function fromSource(source) {
		if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
		else return source;
	}
	Binary.fromSource = fromSource;
	function toBase64(source) {
		source = fromSource(source);
		if (typeof Buffer !== "undefined") return Buffer.from(source).toString("base64");
		let binary = "";
		const bytes = new Uint8Array(source);
		for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
		return btoa(binary);
	}
	Binary.toBase64 = toBase64;
	function fromBase64(source) {
		if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "base64"));
		return Uint8Array.from(atob(source), (c) => c.charCodeAt(0));
	}
	Binary.fromBase64 = fromBase64;
	function toHex(source) {
		source = fromSource(source);
		if (typeof Buffer !== "undefined") return Buffer.from(source).toString("hex");
		return Array.from(new Uint8Array(source), (byte) => byte.toString(16).padStart(2, "0")).join("");
	}
	Binary.toHex = toHex;
	function fromHex(source) {
		if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "hex"));
		const hex = source.length % 2 === 0 ? source : source.slice(0, source.length - 1);
		const buffer = [];
		for (let i = 0; i < hex.length; i += 2) buffer.push(parseInt(`${hex[i]}${hex[i + 1]}`, 16));
		return Uint8Array.from(buffer).buffer;
	}
	Binary.fromHex = fromHex;
})(Binary || (Binary = {}));
Binary.fromBase64;
Binary.toBase64;
Binary.fromHex;
Binary.toHex;
/** Deep-clone common JavaScript values while preserving prototypes and cycles. */
function clone(source, refs = /* @__PURE__ */ new Map()) {
	if (!source || typeof source !== "object") return source;
	if (is("Date", source)) return new Date(source.valueOf());
	if (is("RegExp", source)) return new RegExp(source.source, source.flags);
	if (isArrayBufferLike(source)) return source.slice(0);
	if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
	const cached = refs.get(source);
	if (cached) return cached;
	if (Array.isArray(source)) {
		const result = [];
		refs.set(source, result);
		source.forEach((value, index) => {
			result[index] = Reflect.apply(clone, null, [value, refs]);
		});
		return result;
	}
	const result = Object.create(Object.getPrototypeOf(source));
	refs.set(source, result);
	for (const key of Reflect.ownKeys(source)) {
		const descriptor = { ...Reflect.getOwnPropertyDescriptor(source, key) };
		if ("value" in descriptor) descriptor.value = Reflect.apply(clone, null, [descriptor.value, refs]);
		Reflect.defineProperty(result, key, descriptor);
	}
	return result;
}
/** Deeply compare arrays, dates, regexps, buffers, and plain object fields. */
function deepEqual(a, b, strict) {
	if (a === b) return true;
	if (!strict && isNullable(a) && isNullable(b)) return true;
	if (typeof a !== typeof b) return false;
	if (typeof a !== "object") return false;
	if (!a || !b) return false;
	function check(test, then) {
		return test(a) ? test(b) ? then(a, b) : false : test(b) ? false : void 0;
	}
	return check(Array.isArray, (a, b) => a.length === b.length && a.every((item, index) => deepEqual(item, b[index]))) ?? check(is("Date"), (a, b) => a.valueOf() === b.valueOf()) ?? check(is("RegExp"), (a, b) => a.source === b.source && a.flags === b.flags) ?? check(isArrayBufferLike, (a, b) => {
		if (a.byteLength !== b.byteLength) return false;
		const viewA = new Uint8Array(a);
		const viewB = new Uint8Array(b);
		for (let i = 0; i < viewA.length; i++) if (viewA[i] !== viewB[i]) return false;
		return true;
	}) ?? Object.keys({
		...a,
		...b
	}).every((key) => deepEqual(a[key], b[key], strict));
}
function tokenize(source, delimiters, delimiter) {
	const output = [];
	let state = 0;
	for (let i = 0; i < source.length; i++) {
		const code = source.charCodeAt(i);
		if (code >= 65 && code <= 90) {
			if (state === 1) {
				const next = source.charCodeAt(i + 1);
				if (next >= 97 && next <= 122) output.push(delimiter);
				output.push(code + 32);
			} else {
				if (state !== 0) output.push(delimiter);
				output.push(code + 32);
			}
			state = 1;
		} else if (code >= 97 && code <= 122) {
			output.push(code);
			state = 2;
		} else if (delimiters.includes(code)) {
			if (state !== 0) output.push(delimiter);
			state = 0;
		} else output.push(code);
	}
	return String.fromCharCode(...output);
}
/** Convert text to dash-delimited parameter case. */
function paramCase(source) {
	return tokenize(source, [45, 95], 45);
}
/** Runtime alias for `paramCase`. */
const hyphenate = paramCase;
/** Time constants plus parsing and formatting helpers. */
var Time;
(function(Time) {
	Time.millisecond = 1;
	Time.second = 1e3;
	Time.minute = Time.second * 60;
	Time.hour = Time.minute * 60;
	Time.day = Time.hour * 24;
	Time.week = Time.day * 7;
	let timezoneOffset = (/* @__PURE__ */ new Date()).getTimezoneOffset();
	function setTimezoneOffset(offset) {
		timezoneOffset = offset;
	}
	Time.setTimezoneOffset = setTimezoneOffset;
	function getTimezoneOffset() {
		return timezoneOffset;
	}
	Time.getTimezoneOffset = getTimezoneOffset;
	function getDateNumber(date = /* @__PURE__ */ new Date(), offset) {
		if (typeof date === "number") date = new Date(date);
		if (offset === void 0) offset = timezoneOffset;
		return Math.floor((date.valueOf() / Time.minute - offset) / 1440);
	}
	Time.getDateNumber = getDateNumber;
	function fromDateNumber(value, offset) {
		const date = new Date(value * Time.day);
		if (offset === void 0) offset = timezoneOffset;
		return new Date(+date + offset * Time.minute);
	}
	Time.fromDateNumber = fromDateNumber;
	const numeric = /\d+(?:\.\d+)?/.source;
	const timeRegExp = new RegExp(`^${[
		"w(?:eek(?:s)?)?",
		"d(?:ay(?:s)?)?",
		"h(?:our(?:s)?)?",
		"m(?:in(?:ute)?(?:s)?)?",
		"s(?:ec(?:ond)?(?:s)?)?"
	].map((unit) => `(${numeric}${unit})?`).join("")}$`);
	function parseTime(source) {
		const capture = timeRegExp.exec(source);
		if (!capture) return 0;
		return (parseFloat(capture[1]) * Time.week || 0) + (parseFloat(capture[2]) * Time.day || 0) + (parseFloat(capture[3]) * Time.hour || 0) + (parseFloat(capture[4]) * Time.minute || 0) + (parseFloat(capture[5]) * Time.second || 0);
	}
	Time.parseTime = parseTime;
	function parseDate(date) {
		const parsed = parseTime(date);
		if (parsed) date = Date.now() + parsed;
		else if (/^\d{1,2}(:\d{1,2}){1,2}$/.test(date)) date = `${(/* @__PURE__ */ new Date()).toLocaleDateString()}-${date}`;
		else if (/^\d{1,2}-\d{1,2}-\d{1,2}(:\d{1,2}){1,2}$/.test(date)) date = `${(/* @__PURE__ */ new Date()).getFullYear()}-${date}`;
		return date ? new Date(date) : /* @__PURE__ */ new Date();
	}
	Time.parseDate = parseDate;
	function format(ms) {
		const abs = Math.abs(ms);
		if (abs >= Time.day - Time.hour / 2) return Math.round(ms / Time.day) + "d";
		else if (abs >= Time.hour - Time.minute / 2) return Math.round(ms / Time.hour) + "h";
		else if (abs >= Time.minute - Time.second / 2) return Math.round(ms / Time.minute) + "m";
		else if (abs >= Time.second) return Math.round(ms / Time.second) + "s";
		return ms + "ms";
	}
	Time.format = format;
	function toDigits(source, length = 2) {
		return source.toString().padStart(length, "0");
	}
	Time.toDigits = toDigits;
	function template(template, time = /* @__PURE__ */ new Date()) {
		return template.replace("yyyy", time.getFullYear().toString()).replace("yy", time.getFullYear().toString().slice(2)).replace("MM", toDigits(time.getMonth() + 1)).replace("dd", toDigits(time.getDate())).replace("hh", toDigits(time.getHours())).replace("mm", toDigits(time.getMinutes())).replace("ss", toDigits(time.getSeconds())).replace("SSS", toDigits(time.getMilliseconds(), 3));
	}
	Time.template = template;
})(Time || (Time = {}));
//#endregion
//#region ../../deepseek-harness/vendor/schemastery/lib/index.mjs
const kSchema = Symbol.for("schemastery");
const kValidationError$1 = Symbol.for("ValidationError");
globalThis.__schemastery_index__ ??= 0;
globalThis.__schemastery_refs__ = void 0;
var ValidationError$1 = class extends TypeError {
	options;
	name = "ValidationError";
	constructor(message, options) {
		let prefix = "$";
		for (const segment of options.path || []) if (typeof segment === "string") prefix += "." + segment;
		else if (typeof segment === "number") prefix += "[" + segment + "]";
		else if (typeof segment === "symbol") prefix += `[Symbol(${segment.toString()})]`;
		if (prefix.startsWith(".")) prefix = prefix.slice(1);
		super((prefix === "$" ? "" : `${prefix} `) + message);
		this.options = options;
	}
	static is(error) {
		return !!error?.[kValidationError$1];
	}
};
Object.defineProperty(ValidationError$1.prototype, kValidationError$1, { value: true });
const Schema = function(options) {
	const schema = function(data, options = {}) {
		return Schema.resolve(data, schema, options)[0];
	};
	if (options.refs) {
		const refs = mapValues(options.refs, (options) => new Schema(options));
		const getRef = (uid) => refs[uid];
		for (const key in refs) {
			const options = refs[key];
			options.sKey = getRef(options.sKey);
			options.inner = getRef(options.inner);
			options.list = options.list && options.list.map(getRef);
			options.dict = options.dict && mapValues(options.dict, getRef);
		}
		return refs[options.uid];
	}
	Object.assign(schema, options);
	if (typeof schema.callback === "string") try {
		schema.callback = new Function("return " + schema.callback)();
	} catch {}
	Object.defineProperty(schema, "uid", { value: globalThis.__schemastery_index__++ });
	Object.setPrototypeOf(schema, Schema.prototype);
	schema.meta ||= {};
	schema.toString = schema.toString.bind(schema);
	return schema;
};
Schema.prototype = Object.create(Function.prototype);
Schema.prototype[kSchema] = true;
Object.defineProperty(Schema.prototype, "~standard", { get() {
	return {
		version: 1,
		vendor: "schemastery",
		validate: (value) => {
			try {
				return { value: Schema.resolve(value, this, {})[0] };
			} catch (error) {
				if (ValidationError$1.is(error)) return { issues: [{
					message: error.message,
					path: error.options.path
				}] };
				throw error;
			}
		}
	};
} });
Schema.ValidationError = ValidationError$1;
Schema.prototype.toJSON = function toJSON() {
	if (globalThis.__schemastery_refs__) {
		globalThis.__schemastery_refs__[this.uid] ??= JSON.parse(JSON.stringify({ ...this }));
		return this.uid;
	}
	globalThis.__schemastery_refs__ = { [this.uid]: { ...this } };
	globalThis.__schemastery_refs__[this.uid] = JSON.parse(JSON.stringify({ ...this }));
	const result = {
		uid: this.uid,
		refs: globalThis.__schemastery_refs__
	};
	globalThis.__schemastery_refs__ = void 0;
	return result;
};
Schema.prototype.set = function set(key, value) {
	this.dict[key] = value;
	return this;
};
Schema.prototype.push = function push(value) {
	this.list.push(value);
	return this;
};
function mergeDesc(original, messages) {
	const result = typeof original === "string" ? { "": original } : { ...original };
	for (const locale in messages) {
		const value = messages[locale];
		if (value?.$description || value?.$desc) result[locale] = value.$description || value.$desc;
		else if (typeof value === "string") result[locale] = value;
	}
	return result;
}
function getInner(value) {
	return value?.$value ?? value?.$inner;
}
function extractKeys(data) {
	return filterKeys(data ?? {}, (key) => !key.startsWith("$"));
}
Schema.prototype.i18n = function i18n(messages) {
	const schema = Schema(this);
	const desc = mergeDesc(schema.meta.description, messages);
	if (Object.keys(desc).length) schema.meta.description = desc;
	if (schema.dict) schema.dict = mapValues(schema.dict, (inner, key) => {
		return inner.i18n(mapValues(messages, (data) => getInner(data)?.[key] ?? data?.[key]));
	});
	if (schema.list) schema.list = schema.list.map((inner, index) => {
		return inner.i18n(mapValues(messages, (data = {}) => {
			if (Array.isArray(getInner(data))) return getInner(data)[index];
			if (Array.isArray(data)) return data[index];
			return extractKeys(data);
		}));
	});
	if (schema.inner) schema.inner = schema.inner.i18n(mapValues(messages, (data) => {
		if (getInner(data)) return getInner(data);
		return extractKeys(data);
	}));
	if (schema.sKey) schema.sKey = schema.sKey.i18n(mapValues(messages, (data) => data?.$key));
	return schema;
};
Schema.prototype.extra = function extra(key, value) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		[key]: value
	};
	return schema;
};
for (const key of [
	"required",
	"disabled",
	"collapse",
	"hidden",
	"loose"
]) Object.assign(Schema.prototype, { [key](value = true) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		[key]: value
	};
	return schema;
} });
Schema.prototype.deprecated = function deprecated() {
	const schema = Schema(this);
	schema.meta.badges ||= [];
	schema.meta.badges.push({
		text: "deprecated",
		type: "danger"
	});
	return schema;
};
Schema.prototype.experimental = function experimental() {
	const schema = Schema(this);
	schema.meta.badges ||= [];
	schema.meta.badges.push({
		text: "experimental",
		type: "warning"
	});
	return schema;
};
Schema.prototype.pattern = function pattern(regexp) {
	const schema = Schema(this);
	const pattern = pick(regexp, ["source", "flags"]);
	schema.meta = {
		...schema.meta,
		pattern
	};
	return schema;
};
Schema.prototype.simplify = function simplify(value) {
	if (deepEqual(value, this.meta.default, this.type === "dict")) return null;
	if (isNullable(value)) return value;
	if (this.type === "object" || this.type === "dict") {
		const result = {};
		for (const key in value) {
			const item = (this.type === "object" ? this.dict[key] : this.inner)?.simplify(value[key]);
			if (this.type === "dict" || !isNullable(item)) result[key] = item;
		}
		if (deepEqual(result, this.meta.default, this.type === "dict")) return null;
		return result;
	} else if (this.type === "array" || this.type === "tuple") {
		const result = [];
		value.forEach((value, index) => {
			const schema = this.type === "array" ? this.inner : this.list[index];
			const item = schema ? schema.simplify(value) : value;
			result.push(item);
		});
		return result;
	} else if (this.type === "intersect") {
		const result = {};
		for (const item of this.list) Object.assign(result, item.simplify(value));
		return result;
	} else if (this.type === "union") for (const schema of this.list) try {
		Schema.resolve(value, schema, {});
		return schema.simplify(value);
	} catch {}
	return value;
};
Schema.prototype.toString = function toString(inline) {
	return formatters[this.type]?.(this, inline) ?? `Schema<${this.type}>`;
};
Schema.prototype.role = function role(role, extra) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		role,
		extra
	};
	return schema;
};
for (const key of [
	"default",
	"link",
	"comment",
	"description",
	"max",
	"min",
	"step"
]) Object.assign(Schema.prototype, { [key](value) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		[key]: value
	};
	return schema;
} });
const resolvers = {};
Schema.extend = function extend(type, resolve) {
	resolvers[type] = resolve;
};
Schema.resolve = function resolve(data, schema, options = {}, strict = false) {
	if (!schema) return [data];
	if (options.ignore?.(data, schema)) return [data];
	if (isNullable(data) && schema.type !== "lazy") {
		if (schema.meta.required) throw new ValidationError$1(`missing required value`, options);
		let current = schema;
		let fallback = schema.meta.default;
		while (current?.type === "intersect" && isNullable(fallback)) {
			current = current.list[0];
			fallback = current?.meta.default;
		}
		if (isNullable(fallback)) return [data];
		data = clone(fallback);
	}
	const callback = resolvers[schema.type];
	if (!callback) throw new ValidationError$1(`unsupported type "${schema.type}"`, options);
	try {
		return callback(data, schema, options, strict);
	} catch (error) {
		if (!schema.meta.loose) throw error;
		return [schema.meta.default];
	}
};
Schema.from = function from(source) {
	if (isNullable(source)) return Schema.any();
	else if ([
		"string",
		"number",
		"boolean"
	].includes(typeof source)) return Schema.const(source).required();
	else if (source[kSchema]) return source;
	else if (typeof source === "function") switch (source) {
		case String: return Schema.string().required();
		case Number: return Schema.number().required();
		case Boolean: return Schema.boolean().required();
		case Function: return Schema.function().required();
		default: return Schema.is(source).required();
	}
	else throw new TypeError(`cannot infer schema from ${source}`);
};
Schema.lazy = function lazy(builder) {
	const toJSON = () => {
		if (!schema.inner[kSchema]) {
			schema.inner = schema.builder();
			schema.inner.meta = {
				...schema.meta,
				...schema.inner.meta
			};
		}
		return schema.inner.toJSON();
	};
	const schema = new Schema({
		type: "lazy",
		builder,
		inner: { toJSON }
	});
	return schema;
};
Schema.natural = function natural() {
	return Schema.number().step(1).min(0);
};
Schema.percent = function percent() {
	return Schema.number().step(.01).min(0).max(1).role("slider");
};
Schema.date = function date() {
	return Schema.union([Schema.is(Date), Schema.transform(Schema.string().role("datetime"), (value, options) => {
		const date = new Date(value);
		if (isNaN(+date)) throw new ValidationError$1(`invalid date "${value}"`, options);
		return date;
	}, true)]);
};
Schema.regExp = function regExp(flag = "") {
	return Schema.union([Schema.is(RegExp), Schema.transform(Schema.string().role("regexp", { flag }), (value, options) => {
		try {
			return new RegExp(value, flag);
		} catch (e) {
			throw new ValidationError$1(e.message, options);
		}
	}, true)]);
};
Schema.arrayBuffer = function arrayBuffer(encoding) {
	return Schema.union([
		Schema.is(ArrayBuffer),
		Schema.is(SharedArrayBuffer),
		Schema.transform(Schema.any(), (value, options) => {
			if (Binary.isSource(value)) return Binary.fromSource(value);
			throw new ValidationError$1(`expected ArrayBufferSource but got ${value}`, options);
		}, true),
		...encoding ? [Schema.transform(Schema.string(), (value, options) => {
			try {
				return encoding === "base64" ? Binary.fromBase64(value) : Binary.fromHex(value);
			} catch (e) {
				throw new ValidationError$1(e.message, options);
			}
		}, true)] : []
	]);
};
Schema.extend("lazy", (data, schema, options, strict) => {
	if (!schema.inner[kSchema]) {
		schema.inner = schema.builder();
		schema.inner.meta = {
			...schema.meta,
			...schema.inner.meta
		};
	}
	return Schema.resolve(data, schema.inner, options, strict);
});
Schema.extend("any", (data) => {
	return [data];
});
Schema.extend("never", (data, _, options) => {
	throw new ValidationError$1(`expected nullable but got ${data}`, options);
});
Schema.extend("const", (data, { value }, options) => {
	if (deepEqual(data, value)) return [value];
	throw new ValidationError$1(`expected ${value} but got ${data}`, options);
});
function checkWithinRange(data, meta, description, options, skipMin = false) {
	const { max = Infinity, min = -Infinity } = meta;
	if (data > max) throw new ValidationError$1(`expected ${description} <= ${max} but got ${data}`, options);
	if (data < min && !skipMin) throw new ValidationError$1(`expected ${description} >= ${min} but got ${data}`, options);
}
Schema.extend("string", (data, { meta }, options) => {
	if (typeof data !== "string") throw new ValidationError$1(`expected string but got ${data}`, options);
	if (meta.pattern) {
		const regexp = new RegExp(meta.pattern.source, meta.pattern.flags);
		if (!regexp.test(data)) throw new ValidationError$1(`expect string to match regexp ${regexp}`, options);
	}
	checkWithinRange(data.length, meta, "string length", options);
	return [data];
});
function decimalShift(data, digits) {
	const str = data.toString();
	if (str.includes("e")) return data * Math.pow(10, digits);
	const index = str.indexOf(".");
	if (index === -1) return data * Math.pow(10, digits);
	const frac = str.slice(index + 1);
	const integer = str.slice(0, index);
	if (frac.length <= digits) return +(integer + frac.padEnd(digits, "0"));
	return +(integer + frac.slice(0, digits) + "." + frac.slice(digits));
}
function isMultipleOf(data, min, step) {
	step = Math.abs(step);
	if (!/^\d+\.\d+$/.test(step.toString())) return (data - min) % step === 0;
	const index = step.toString().indexOf(".");
	const digits = step.toString().slice(index + 1).length;
	return Math.abs(decimalShift(data, digits) - decimalShift(min, digits)) % decimalShift(step, digits) === 0;
}
Schema.extend("number", (data, { meta }, options) => {
	if (typeof data !== "number") throw new ValidationError$1(`expected number but got ${data}`, options);
	checkWithinRange(data, meta, "number", options);
	const { step } = meta;
	if (step && !isMultipleOf(data, meta.min ?? 0, step)) throw new ValidationError$1(`expected number multiple of ${step} but got ${data}`, options);
	return [data];
});
Schema.extend("boolean", (data, _, options) => {
	if (typeof data === "boolean") return [data];
	throw new ValidationError$1(`expected boolean but got ${data}`, options);
});
Schema.extend("bitset", (data, { bits, meta }, options) => {
	let value = 0, keys = [];
	if (typeof data === "number") {
		value = data;
		for (const key in bits) if (data & bits[key]) keys.push(key);
	} else if (Array.isArray(data)) {
		keys = data;
		for (const key of keys) {
			if (typeof key !== "string") throw new ValidationError$1(`expected string but got ${key}`, options);
			if (key in bits) value |= bits[key];
		}
	} else throw new ValidationError$1(`expected number or array but got ${data}`, options);
	if (value === meta.default) return [value];
	return [value, keys];
});
Schema.extend("function", (data, _, options) => {
	if (typeof data === "function") return [data];
	throw new ValidationError$1(`expected function but got ${data}`, options);
});
Schema.extend("is", (data, { constructor }, options) => {
	if (typeof constructor === "function") {
		if (data instanceof constructor) return [data];
		throw new ValidationError$1(`expected ${constructor.name} but got ${data}`, options);
	} else {
		if (isNullable(data)) throw new ValidationError$1(`expected ${constructor} but got ${data}`, options);
		let prototype = Object.getPrototypeOf(data);
		while (prototype) {
			if (prototype.constructor?.name === constructor) return [data];
			prototype = Object.getPrototypeOf(prototype);
		}
		throw new ValidationError$1(`expected ${constructor} but got ${data}`, options);
	}
});
function property(data, key, schema, options) {
	try {
		const [value, adapted] = Schema.resolve(data[key], schema, {
			...options,
			path: [...options.path || [], key]
		});
		if (adapted !== void 0) data[key] = adapted;
		return value;
	} catch (e) {
		if (!options?.autofix) throw e;
		delete data[key];
		return schema.meta.default;
	}
}
Schema.extend("array", (data, { inner, meta }, options) => {
	if (!Array.isArray(data)) throw new ValidationError$1(`expected array but got ${data}`, options);
	checkWithinRange(data.length, meta, "array length", options, !isNullable(inner.meta.default));
	return [data.map((_, index) => property(data, index, inner, options))];
});
Schema.extend("dict", (data, { inner, sKey }, options, strict) => {
	if (!isPlainObject$1(data)) throw new ValidationError$1(`expected object but got ${data}`, options);
	const result = {};
	for (const key in data) {
		let rKey;
		try {
			rKey = Schema.resolve(key, sKey, options)[0];
		} catch (error) {
			if (strict) continue;
			throw error;
		}
		result[rKey] = property(data, key, inner, options);
		data[rKey] = data[key];
		if (key !== rKey) delete data[key];
	}
	return [result];
});
Schema.extend("tuple", (data, { list }, options, strict) => {
	if (!Array.isArray(data)) throw new ValidationError$1(`expected array but got ${data}`, options);
	const result = list.map((inner, index) => property(data, index, inner, options));
	if (strict) return [result];
	result.push(...data.slice(list.length));
	return [result];
});
function merge(result, data) {
	for (const key in data) {
		if (key in result) continue;
		result[key] = data[key];
	}
}
Schema.extend("object", (data, { dict }, options, strict) => {
	if (!isPlainObject$1(data)) throw new ValidationError$1(`expected object but got ${data}`, options);
	const result = {};
	for (const key in dict) {
		const value = property(data, key, dict[key], options);
		if (!isNullable(value) || key in data) result[key] = value;
	}
	if (!strict) merge(result, data);
	return [result];
});
Schema.extend("union", (data, { list, toString }, options, strict) => {
	const messages = [];
	for (const inner of list) try {
		return Schema.resolve(data, inner, options, strict);
	} catch (error) {
		messages.push(error);
	}
	throw new ValidationError$1(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
});
Schema.extend("intersect", (data, { list, toString }, options, strict) => {
	if (!list.length) return [data];
	let result;
	for (const inner of list) {
		const value = Schema.resolve(data, inner, options, true)[0];
		if (isNullable(value)) continue;
		if (isNullable(result)) result = value;
		else if (typeof result !== typeof value) throw new ValidationError$1(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
		else if (typeof value === "object") merge(result ??= {}, value);
		else if (result !== value) throw new ValidationError$1(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
	}
	if (!strict && isPlainObject$1(data)) merge(result, data);
	return [result];
});
Schema.extend("transform", (data, { inner, callback, preserve }, options) => {
	const [result, adapted = data] = Schema.resolve(data, inner, options, true);
	if (preserve) return [callback(result)];
	else return [callback(result), callback(adapted)];
});
const formatters = {};
function defineMethod(name, keys, format) {
	formatters[name] = format;
	Object.assign(Schema, { [name](...args) {
		const schema = new Schema({ type: name });
		keys.forEach((key, index) => {
			switch (key) {
				case "sKey":
					schema.sKey = args[index] ?? Schema.string();
					break;
				case "inner":
					schema.inner = Schema.from(args[index]);
					break;
				case "list":
					schema.list = args[index].map(Schema.from);
					break;
				case "dict":
					schema.dict = mapValues(args[index], Schema.from);
					break;
				case "bits":
					schema.bits = {};
					for (const key in args[index]) {
						if (typeof args[index][key] !== "number") continue;
						schema.bits[key] = args[index][key];
					}
					break;
				case "callback": {
					const callback = schema.callback = args[index];
					callback["toJSON"] ||= () => callback.toString();
					break;
				}
				case "constructor": {
					const constructor = schema.constructor = args[index];
					if (typeof constructor === "function") constructor["toJSON"] ||= () => constructor["name"];
					break;
				}
				default: schema[key] = args[index];
			}
		});
		if (name === "object" || name === "dict") schema.meta.default = {};
		else if (name === "array" || name === "tuple") schema.meta.default = [];
		else if (name === "bitset") schema.meta.default = 0;
		return schema;
	} });
}
defineMethod("is", ["constructor"], ({ constructor }) => {
	if (typeof constructor === "function") return constructor.name;
	else return constructor;
});
defineMethod("any", [], () => "any");
defineMethod("never", [], () => "never");
defineMethod("const", ["value"], ({ value }) => typeof value === "string" ? JSON.stringify(value) : value);
defineMethod("string", [], () => "string");
defineMethod("number", [], () => "number");
defineMethod("boolean", [], () => "boolean");
defineMethod("bitset", ["bits"], () => "bitset");
defineMethod("function", [], () => "function");
defineMethod("array", ["inner"], ({ inner }) => `${inner.toString(true)}[]`);
defineMethod("dict", ["inner", "sKey"], ({ inner, sKey }) => `{ [key: ${sKey.toString()}]: ${inner.toString()} }`);
defineMethod("tuple", ["list"], ({ list }) => `[${list.map((inner) => inner.toString()).join(", ")}]`);
defineMethod("object", ["dict"], ({ dict }) => {
	if (Object.keys(dict).length === 0) return "{}";
	return `{ ${Object.entries(dict).map(([key, inner]) => {
		return `${key}${inner.meta.required ? "" : "?"}: ${inner.toString()}`;
	}).join(", ")} }`;
});
defineMethod("union", ["list"], ({ list }, inline) => {
	const result = list.map(({ toString: format }) => format()).join(" | ");
	return inline ? `(${result})` : result;
});
defineMethod("intersect", ["list"], ({ list }) => {
	return `${list.map((inner) => inner.toString(true)).join(" & ")}`;
});
defineMethod("transform", [
	"inner",
	"callback",
	"preserve"
], ({ inner }, isInner) => inner.toString(isInner));
//#endregion
//#region ../../deepseek-harness/vendor/cordis/lib/index.js
/** Ordered collection of disposable values with O(1) deletion by value. */
var DisposableList = class {
	sn = 0;
	map = /* @__PURE__ */ new Map();
	weak = /* @__PURE__ */ new WeakMap();
	get length() {
		return this.map.size;
	}
	push(value) {
		const sn = ++this.sn;
		this.map.set(sn, value);
		this.weak.set(value, sn);
		return () => this.map.delete(sn);
	}
	delete(value) {
		const sn = this.weak.get(value);
		if (!sn) return false;
		return this.map.delete(sn);
	}
	clear() {
		const values = [...this.map.values()];
		this.map.clear();
		return values.reverse();
	}
	[Symbol.iterator]() {
		return this.map.values();
	}
	[Symbol.for("nodejs.util.inspect.custom")]() {
		return [...this];
	}
};
/** Shared symbols used to avoid public property-name collisions. */
const symbols = {
	shadow: Symbol.for("cordis.shadow"),
	receiver: Symbol.for("cordis.receiver"),
	original: Symbol.for("cordis.original"),
	metadata: Symbol.for("cordis.metadata"),
	initHooks: Symbol.for("cordis.initHooks"),
	checkProto: Symbol.for("cordis.checkProto"),
	effect: Symbol.for("cordis.effect"),
	filter: Symbol.for("cordis.filter"),
	isolate: Symbol.for("cordis.isolate"),
	intercept: Symbol.for("cordis.intercept"),
	init: Symbol.for("cordis.init"),
	check: Symbol.for("cordis.check"),
	config: Symbol.for("cordis.config"),
	invoke: Symbol.for("cordis.invoke"),
	extend: Symbol.for("cordis.extend"),
	tracker: Symbol.for("cordis.tracker"),
	resolveConfig: Symbol.for("cordis.resolveConfig")
};
const GeneratorFunction = function* () {}.constructor;
const AsyncGeneratorFunction = async function* () {}.constructor;
/** Return true when a plugin callback should be constructed with `new`. */
function isConstructor(func) {
	if (!func.prototype) return false;
	if (func instanceof GeneratorFunction) return false;
	if (AsyncGeneratorFunction !== Function && func instanceof AsyncGeneratorFunction) return false;
	return true;
}
/** Merge two prototype chains while preserving descriptors from `proto1`. */
function joinPrototype(proto1, proto2) {
	if (proto1 === Object.prototype) return proto2;
	const result = Object.create(joinPrototype(Object.getPrototypeOf(proto1), proto2));
	for (const key of Reflect.ownKeys(proto1)) Object.defineProperty(result, key, Object.getOwnPropertyDescriptor(proto1, key));
	return result;
}
/** Return true for non-null objects and functions. */
function isObject(value) {
	return value && (typeof value === "object" || typeof value === "function");
}
/** Find a property descriptor by walking an object's prototype chain. */
function getPropertyDescriptor(target, prop) {
	let proto = target;
	while (proto) {
		const desc = Reflect.getOwnPropertyDescriptor(proto, prop);
		if (desc) return desc;
		proto = Object.getPrototypeOf(proto);
	}
}
/** Wrap services/functions so method calls see the caller's active context. */
function getTraceable(ctx, value) {
	if (!isObject(value)) return value;
	if (Object.hasOwn(value, symbols.shadow)) return Object.getPrototypeOf(value);
	const tracker = value[symbols.tracker];
	if (!tracker) return value;
	return createTraceable(ctx, value, tracker);
}
/** Return a proxy that overlays readonly or writable properties onto a target. */
function withProps(target, props) {
	if (!props) return target;
	return new Proxy(target, {
		get: (target, prop, receiver) => {
			if (prop in props && prop !== "constructor") return Reflect.get(props, prop, receiver);
			return Reflect.get(target, prop, receiver);
		},
		set: (target, prop, value, receiver) => {
			if (prop in props && prop !== "constructor") return Reflect.set(props, prop, value, receiver);
			return Reflect.set(target, prop, value, receiver);
		}
	});
}
function withProp(target, prop, value) {
	return withProps(target, Object.defineProperty(Object.create(null), prop, {
		value,
		writable: false
	}));
}
function createShadow(ctx, target, property, receiver) {
	if (!property) return receiver;
	const origin = Reflect.getOwnPropertyDescriptor(target, property)?.value;
	if (!origin) return receiver;
	return withProp(receiver, property, ctx.extend({ [symbols.shadow]: origin }));
}
function createShadowMethod(ctx, value, outer, shadow) {
	return new Proxy(value, { apply: (target, thisArg, args) => {
		if (thisArg === outer) thisArg = shadow;
		return getTraceable(ctx, Reflect.apply(target, thisArg, args));
	} });
}
function createTraceable(ctx, value, tracker) {
	if (ctx[symbols.shadow] && !tracker.noShadow) ctx = Object.getPrototypeOf(ctx);
	const proxy = new Proxy(value, {
		get: (target, prop, receiver) => {
			if (prop === symbols.original) return target;
			if (prop === tracker.property) return ctx;
			if (typeof prop === "symbol") return Reflect.get(target, prop, receiver);
			if (tracker.associate && ctx.reflect.props[`${tracker.associate}.${prop}`]) return Reflect.get(ctx, `${tracker.associate}.${prop}`, withProp(ctx, symbols.receiver, receiver));
			let shadow, innerValue;
			const desc = getPropertyDescriptor(target, prop);
			if (desc && "value" in desc) innerValue = desc.value;
			else {
				shadow = createShadow(ctx, target, tracker.property, receiver);
				innerValue = Reflect.get(target, prop, shadow);
			}
			const innerTracker = innerValue?.[symbols.tracker];
			if (innerTracker) return createTraceable(ctx, innerValue, innerTracker);
			else if (!tracker.noShadow && typeof innerValue === "function") {
				shadow ??= createShadow(ctx, target, tracker.property, receiver);
				return createShadowMethod(ctx, innerValue, receiver, shadow);
			} else return innerValue;
		},
		set: (target, prop, value, receiver) => {
			if (prop === symbols.original) return false;
			if (prop === tracker.property) return false;
			if (typeof prop === "symbol") return Reflect.set(target, prop, value, receiver);
			if (tracker.associate && ctx.reflect.props[`${tracker.associate}.${prop}`]) return Reflect.set(ctx, `${tracker.associate}.${prop}`, value, withProp(ctx, symbols.receiver, receiver));
			const shadow = createShadow(ctx, target, tracker.property, receiver);
			return Reflect.set(target, prop, value, shadow);
		},
		apply: (target, thisArg, args) => {
			return applyTraceable(proxy, target, thisArg, args);
		}
	});
	return proxy;
}
function applyTraceable(proxy, value, thisArg, args) {
	if (!value[symbols.invoke]) return Reflect.apply(value, thisArg, args);
	return value[symbols.invoke].apply(proxy, args);
}
/** Create a callable service object that dispatches through `symbols.invoke`. */
function createCallable(name, proto, tracker) {
	const self = function(...args) {
		return applyTraceable(createTraceable(self["ctx"], self, tracker), self, this, args);
	};
	defineProperty(self, "name", name);
	return Object.setPrototypeOf(self, proto);
}
function handleError(info, reason, getOuterStack) {
	const innerLines = info.error.stack.split("\n");
	if (typeof reason?.stack !== "string") {
		const outerError = new Error(reason);
		const lines = outerError.stack.split("\n");
		lines.splice(1, Infinity, ...getOuterStack());
		outerError.stack = lines.join("\n");
		throw outerError;
	}
	const lines = reason.stack.split("\n");
	let index = lines.indexOf(innerLines[2]);
	if (index === -1) throw reason;
	index -= info.offset;
	while (index > 0) {
		if (!lines[index - 1].endsWith(" (<anonymous>)")) break;
		index -= 1;
	}
	lines.splice(index, Infinity, ...getOuterStack());
	reason.stack = lines.join("\n");
	throw reason;
}
/** Run a callback and splice outer call-site frames into thrown async errors. */
function composeError(callback, getOuterStack = buildOuterStack()) {
	const info = {
		offset: 1,
		error: /* @__PURE__ */ new Error()
	};
	try {
		const result = callback(info);
		if (isObject(result) && "then" in result) return result.then(void 0, (reason) => handleError(info, reason, getOuterStack));
		else return result;
	} catch (reason) {
		handleError(info, reason, getOuterStack);
	}
}
/** Capture a lazy stack-frame supplier for later error composition. */
function buildOuterStack(offset = 0) {
	const outerError = /* @__PURE__ */ new Error();
	return () => outerError.stack.split("\n").slice(3 + offset);
}
/**
* Return whether an event result should stop a bail-style dispatch.
*
* @param value — a listener's return value.
* @returns `true` unless `value` is `null`, `false`, or `undefined`.
*/
function isBailed(value) {
	return value !== null && value !== false && value !== void 0;
}
/**
* Event bus installed as `ctx.events` and mixed into every context.
*
* The service supports concurrent, synchronous, serial, bail, and waterfall
* dispatch and automatically disposes listeners with their owning fiber.
*/
var EventsService = class {
	ctx;
	_hooks = {};
	constructor(ctx) {
		this.ctx = ctx;
		defineProperty(this, symbols.tracker, {
			property: "ctx",
			noShadow: true
		});
		this.on("internal/listener", function(name, listener, options) {
			if (name === "internal/update" && !options.global) return (this.fiber._hooks["internal/update"] ??= new DisposableList())[options.prepend ? "unshift" : "push"](listener);
		});
		this.on("internal/update", function(config, noSave, next) {
			const cbs = [...this._hooks["internal/update"] || []];
			const _next = () => {
				return (cbs.shift() ?? next).call(this, config, noSave, _next);
			};
			return _next();
		}, {
			global: true,
			prepend: true
		});
	}
	/**
	* Resolve listeners for one dispatch and apply context filtering.
	*
	* @param type — the dispatch mode, reported on `internal/dispatch`.
	* @param args — the raw dispatch arguments; consumed up to the event name.
	* @returns the matching listener callbacks, bound to the dispatch `this`.
	*/
	dispatch(type, args) {
		const thisArg = typeof args[0] === "object" || typeof args[0] === "function" ? args.shift() : null;
		const name = args.shift();
		if (!name.startsWith("internal/")) this.emit("internal/dispatch", type, name, args, thisArg);
		const filter = thisArg?.[Context.filter];
		return (this._hooks[name] || []).filter((hook) => hook.global || !filter || filter.call(thisArg, hook.ctx)).map((hook) => hook.callback.bind(thisArg));
	}
	/**
	* Run listeners concurrently and wait for all of them.
	*
	* @param args — optional `this`, the event name, then listener arguments.
	* @returns a promise resolving once every listener has settled.
	*/
	async parallel(...args) {
		const errors = (await Promise.allSettled(this.dispatch("emit", args).map(async (cb) => cb(...args)))).filter((result) => result.status === "rejected");
		if (errors.length) throw new AggregateError(errors.map((error) => error.reason));
	}
	/**
	* Run listeners synchronously without waiting for returned promises.
	*
	* @param args — optional `this`, the event name, then listener arguments.
	*/
	emit(...args) {
		this.dispatch("emit", args).map((cb) => cb(...args));
	}
	/**
	* Run listeners in order, awaiting each, until one returns a bail value.
	*
	* @param args — optional `this`, the event name, then listener arguments.
	* @returns the first bail value (see {@link isBailed}), if any.
	*/
	async serial(...args) {
		for (const cb of this.dispatch("serial", args)) {
			const result = await cb(...args);
			if (isBailed(result)) return result;
		}
	}
	/**
	* Run listeners synchronously until one returns a bail value.
	*
	* @param args — optional `this`, the event name, then listener arguments.
	* @returns the first bail value (see {@link isBailed}), if any.
	*/
	bail(...args) {
		for (const cb of this.dispatch("bail", args)) {
			const result = cb(...args);
			if (isBailed(result)) return result;
		}
	}
	/**
	* Compose listeners around the final `next` callback.
	*
	* The last dispatch argument is treated as the innermost `next`. Listeners
	* run outermost-first; a listener that does not call `next()` vetoes the
	* rest of the chain, including the built-in behavior.
	*
	* @param args — optional `this`, the event name, listener arguments, then `next`.
	* @returns the outermost listener's return value.
	*/
	waterfall(...args) {
		const cbs = this.dispatch("waterfall", args);
		const inner = args.pop();
		const next = () => {
			return (cbs.shift() ?? inner)(...args);
		};
		args.push(next);
		return next();
	}
	/**
	* Store a listener record as an effect on the current fiber.
	*
	* @param label — effect label shown in fiber diagnostics.
	* @param hooks — the listener list for one event.
	* @param callback — the listener to store.
	* @param options — placement and filtering options.
	* @returns a disposer that unregisters the listener.
	*/
	register(label, hooks, callback, options) {
		const method = options.prepend ? "unshift" : "push";
		return this.ctx.fiber.effect(() => {
			hooks[method]({
				ctx: this.ctx,
				callback,
				...options
			});
			return () => this.unregister(hooks, callback);
		}, label);
	}
	/**
	* Remove a stored listener record.
	*
	* @param hooks — the listener list for one event.
	* @param callback — the listener to remove.
	* @returns `true` if the listener was found and removed.
	*/
	unregister(hooks, callback) {
		const index = hooks.findIndex((hook) => hook.callback === callback);
		if (index >= 0) {
			hooks.splice(index, 1);
			return true;
		}
	}
	/**
	* Register an event listener owned by the current fiber.
	*
	* The listener is removed automatically when the fiber unloads. Throws
	* `CordisError('INACTIVE_EFFECT')` if the fiber is already disposed.
	*
	* @param name — the event name to listen for.
	* @param listener — called with the dispatch arguments.
	* @param options — listener options; a boolean is shorthand for `prepend`.
	* @returns a disposer removing the listener; `true` if it was still registered.
	*/
	on(name, listener, options) {
		if (typeof options !== "object") options = { prepend: options };
		this.ctx.fiber.assertActive();
		listener = this.ctx.reflect.bind(listener);
		const result = this.bail(this.ctx, "internal/listener", name, listener, options);
		if (result) return result;
		const hooks = this._hooks[name] ||= [];
		const label = `ctx.on(${typeof name === "string" ? JSON.stringify(name) : name.toString()})`;
		return this.register(label, hooks, listener, options);
	}
	/**
	* Register an event listener that disposes itself after the first call.
	*
	* @param name — the event name to listen for.
	* @param listener — called at most once with the dispatch arguments.
	* @param options — listener options; a boolean is shorthand for `prepend`.
	* @returns a disposer removing the listener; `true` if it was still registered.
	*/
	once(name, listener, options) {
		const dispose = this.on(name, function(...args) {
			dispose();
			return listener.apply(this, args);
		}, options);
		return dispose;
	}
};
/** Built-in placeholder formatters used by `Logger.format()`. */
const defaultFormatters = {
	s: (value) => String(value),
	d: (value) => Math.trunc(Number(value)),
	i: (value) => Math.trunc(Number(value)),
	f: (value) => Number(value),
	o: (value) => JSON.stringify(value),
	O: (value) => JSON.stringify(value),
	c: () => "",
	C: (value, exporter, message) => {
		return Logger.color(exporter, Logger.code(message.name, exporter.colors), value);
	}
};
function isAggregateError(error) {
	return error instanceof Error && Array.isArray(error["errors"]);
}
/** Logger facade for one named subsystem. */
var Logger = class {
	service;
	static color(exporter, code, value, decoration = "") {
		if (!exporter.colors) return "" + value;
		return `\u001b[3${code < 8 ? code : "8;5;" + code}${exporter.colors >= 2 ? decoration : ""}m${value}\u001b[0m`;
	}
	static code(name, level) {
		let hash = 0;
		for (let i = 0; i < name.length; i++) {
			hash = (hash << 3) - hash + name.charCodeAt(i) + 13;
			hash |= 0;
		}
		const colors = !level ? [] : level >= 2 ? c256 : c16;
		return colors[Math.abs(hash) % colors.length];
	}
	static format(exporter, message) {
		const args = message.args.slice();
		if (args[0] instanceof Error) {
			args[0] = args[0].stack || args[0].message;
			args.unshift("%s");
		} else if (typeof args[0] !== "string") args.unshift("%o");
		let format = args.shift();
		format = format.replace(/%([a-zA-Z%])/g, (match, char) => {
			if (match === "%%") return "%";
			const formatter = exporter.formatters?.[char] ?? defaultFormatters[char];
			if (typeof formatter === "function") return formatter(args.shift(), exporter, message);
			return match;
		});
		const oFormatter = exporter.formatters?.o ?? defaultFormatters.o;
		for (let arg of args) {
			if (typeof arg === "object" && arg) arg = oFormatter(arg, exporter, message);
			format += " " + arg;
		}
		const { maxLength = 10240 } = exporter;
		return format.split(/\r?\n/g).map((line) => {
			return line.slice(0, maxLength) + (line.length > maxLength ? "..." : "");
		}).join("\n");
	}
	constructor(options, service) {
		this.service = service;
		Object.assign(this, options);
		this.error = this._method("error", 0);
		this.info = this._method("info", 1);
		this.warn = this._method("warn", 2);
		this.debug = this._method("debug", 3);
	}
	_method(type, level) {
		return (...args) => {
			if (args.length === 1 && args[0] instanceof Error) {
				if (args[0].cause) this[type](args[0].cause);
				else if (isAggregateError(args[0])) {
					args[0].errors.forEach((error) => this[type](error));
					return;
				}
			}
			const sn = ++this.service._snMessage;
			const ts = Date.now();
			for (const exporter of this.service.exporters.values()) {
				if ((exporter.levels?.[this.name] ?? exporter.levels?.default ?? this.level ?? 1) < level) continue;
				const message = {
					sn,
					ts,
					type,
					level,
					name: this.name,
					...this.meta,
					args
				};
				exporter.export(message);
			}
		};
	}
};
/** ANSI 16-color palette indexes used for logger name coloring. */
const c16 = [
	6,
	2,
	3,
	4,
	5,
	1
];
/** ANSI 256-color palette indexes used for logger name coloring. */
const c256 = [
	20,
	21,
	26,
	27,
	32,
	33,
	38,
	39,
	40,
	41,
	42,
	43,
	44,
	45,
	56,
	57,
	62,
	63,
	68,
	69,
	74,
	75,
	76,
	77,
	78,
	79,
	80,
	81,
	92,
	93,
	98,
	99,
	112,
	113,
	129,
	134,
	135,
	148,
	149,
	160,
	161,
	162,
	163,
	164,
	165,
	166,
	167,
	168,
	169,
	170,
	171,
	172,
	173,
	178,
	179,
	184,
	185,
	196,
	197,
	198,
	199,
	200,
	201,
	202,
	203,
	204,
	205,
	206,
	207,
	208,
	209,
	214,
	215,
	220,
	221
];
/**
* Built-in logging service.
*
* Call `ctx.logger()` to create a named logger, or call `ctx.logger.info()`
* directly to log with the current fiber-derived name.
*/
var LoggerService = class LoggerService {
	bufferSize = 1e3;
	buffer = [];
	ctx;
	_snMessage = 0;
	_snExporter = 0;
	exporters = /* @__PURE__ */ new Map();
	constructor(ctx) {
		const tracker = {
			property: "ctx",
			noShadow: true
		};
		const self = createCallable("logger", joinPrototype(Object.getPrototypeOf(this), Function.prototype), tracker);
		Object.assign(self, this);
		self.ctx = ctx;
		defineProperty(self, symbols.tracker, tracker);
		self.exporter({
			colors: 3,
			export: (message) => {
				self.buffer.push(message);
				if (self.buffer.length > self.bufferSize) self.buffer = self.buffer.slice(-self.bufferSize);
			}
		});
		return self;
	}
	/**
	* Register an exporter and dispose it with the current fiber.
	*
	* @param exporter — the sink that receives structured log messages.
	* @returns a disposer that removes the exporter.
	*/
	exporter(exporter) {
		return this.ctx.effect(() => {
			this.exporters.set(++this._snExporter, exporter);
			return () => this.exporters.delete(this._snExporter);
		}, "ctx.logger.exporter()");
	}
	_resolveConfig() {
		let intercept = this.ctx[symbols.intercept];
		const configs = [];
		while ("logger" in intercept) {
			if (Object.hasOwn(intercept, "logger")) configs.unshift(intercept["logger"]);
			intercept = Object.getPrototypeOf(intercept);
		}
		return Object.assign({}, ...configs);
	}
	[symbols.invoke](name) {
		const config = this._resolveConfig();
		const fiber = (this.ctx[symbols.shadow] ?? this.ctx).fiber;
		name ??= config.name;
		name ??= hyphenate(fiber.name);
		return new Logger({
			name,
			level: config.level,
			meta: { fiber: new WeakRef(fiber) }
		}, this);
	}
	static {
		for (const type of [
			"error",
			"info",
			"warn",
			"debug"
		]) LoggerService.prototype[type] = function(...args) {
			return this()[type](...args);
		};
	}
};
function enhanceError(error) {
	const lines = error.stack.split("\n");
	lines.splice(0, 2, `Error: ${error.message}`);
	error.stack = lines.join("\n");
	return error;
}
const RESERVED_WORDS = ["prototype", "then"];
function isSpecialProperty(prop) {
	return typeof prop === "symbol" || RESERVED_WORDS.includes(prop) || parseInt(prop).toString() === prop || prop.startsWith("_");
}
/**
* Reflection and service-resolution layer installed as `ctx.reflect`.
*
* This service powers the context proxy, service registration, accessors, and
* the mixins that expose core service methods directly on `ctx`.
*/
var ReflectService = class {
	ctx;
	/** Proxy traps implementing service resolution for every context object. */
	static handler = {
		get: (target, prop, ctx) => {
			if (isSpecialProperty(prop)) return Reflect.get(target, prop, ctx);
			if (Reflect.has(target, prop)) return getTraceable(ctx, Reflect.get(target, prop, ctx));
			const error = /* @__PURE__ */ new Error(`cannot get property "${prop}" without inject`);
			try {
				const def = target.reflect.props[prop];
				if (def?.type === "accessor") return def.get.call(ctx, ctx[symbols.receiver], error);
				if (!ctx.fiber.runtime) return ctx.reflect.get(prop, false);
				return ctx.events.waterfall("internal/get", ctx, prop, error, () => {
					const key = target[symbols.isolate][prop];
					let fiber = (ctx[symbols.shadow] ?? ctx).fiber;
					while (true) {
						const impl = fiber.store?.[prop];
						if (impl) return getTraceable(ctx, impl.value);
						if (prop in fiber.inject) {
							error.message = `cannot get required service "${prop}" in inactive context`;
							throw error;
						}
						if (!fiber.runtime) throw error;
						if (fiber.parent[symbols.isolate][prop] !== key) throw error;
						fiber = fiber.parent.fiber;
					}
				});
			} catch (e) {
				throw e === error ? enhanceError(e) : e;
			}
		},
		set: (target, prop, value, ctx) => {
			if (isSpecialProperty(prop)) return Reflect.set(target, prop, value, ctx);
			const error = /* @__PURE__ */ new Error(`cannot set property "${prop}" without provide`);
			const def = target.reflect.props[prop];
			if (!def) {
				if (!ctx.fiber.runtime) return Reflect.set(target, prop, value, ctx);
				throw enhanceError(error);
			}
			try {
				if (def.type === "accessor") {
					if (!def.set) return false;
					return def.set.call(ctx, value, ctx[symbols.receiver], error);
				}
				return ctx.events.waterfall("internal/set", ctx, prop, value, error, () => {
					return ctx.reflect.set(prop, value, error);
				});
			} catch (e) {
				throw e === error ? enhanceError(e) : e;
			}
		},
		has: (target, prop) => {
			if (isSpecialProperty(prop)) return Reflect.has(target, prop);
			if (Reflect.has(target, prop)) return true;
			return !!target.reflect.props[prop];
		}
	};
	/** Service implementations, keyed by isolation label. */
	store = Object.create(null);
	/** Declared context properties (services and accessors), by name. */
	props = Object.create(null);
	constructor(ctx) {
		this.ctx = ctx;
		defineProperty(this, symbols.tracker, {
			property: "ctx",
			noShadow: true
		});
		this.mixin("reflect", [
			"get",
			"set",
			"provide",
			"accessor",
			"mixin"
		]);
		this.mixin("fiber", ["runtime", "effect"]);
		this.mixin("registry", ["inject", "plugin"]);
		this.mixin("events", [
			"on",
			"once",
			"parallel",
			"emit",
			"serial",
			"bail",
			"waterfall"
		]);
	}
	/**
	* Read a service from the store without the inject requirement.
	*
	* @param name — the service name.
	* @param strict — when `true`, only return implementations whose providing
	* fiber is currently active.
	* @returns the service value, or `undefined` when not (yet) provided.
	*/
	get(name, strict = true) {
		return getTraceable(this.ctx, this._getImpl(name, strict)?.value);
	}
	_getImpl(name, strict = true) {
		const key = this.ctx[symbols.isolate][name];
		const impl = key && this.store[key];
		if (!impl) return;
		if (strict && impl.fiber.state !== 2) return;
		return impl;
	}
	/**
	* Overwrite a provided service's value.
	*
	* @param name — the service name.
	* @param value — the new service value.
	* @param error — carrier for the caller stack in diagnostics.
	* @returns `true` on success.
	* @throws when `name` was never provided, or was provided by another fiber.
	*/
	set(name, value, error) {
		const key = this.ctx[symbols.isolate][name];
		const impl = this.store[key];
		if (!impl) throw new Error(`cannot set property "${name}" without provide`);
		if (impl.fiber !== this.ctx.fiber) throw new Error(`cannot set property "${name}" in multiple fibers`);
		impl.value = value;
		return true;
	}
	/**
	* Register a service implementation owned by the current fiber.
	*
	* See the `ctx.provide()` overload above for the full contract.
	*
	* @param name — the service name.
	* @param value — the service value.
	* @param check — optional availability predicate for dependents.
	* @returns a disposer that unregisters the service.
	*/
	provide(name, value, check) {
		return this.ctx.fiber.effect(() => {
			if (!this.props[name]) this.props[name] ??= { type: "service" };
			else if (this.props[name].type !== "service") throw new Error(`property "${name}" is already declared as ${this.props[name].type}`);
			this.props[name] = { type: "service" };
			this.ctx.root[symbols.isolate][name] ??= Symbol(name);
			const key = this.ctx[symbols.isolate][name];
			const impl = {
				name,
				value,
				fiber: this.ctx.fiber,
				check
			};
			if (this.store[key]) throw new Error(`service "${name}" has been registered at <${this.store[key].fiber.name}>`);
			this.store[key] = impl;
			this.ctx.fiber.store[name] = impl;
			if (this.ctx.fiber.state === 2) this.notify([name]);
			return async () => {
				delete this.store[key];
				const fibers = this.notify([name]);
				await Promise.allSettled(fibers.map((fiber) => fiber.await()));
				delete this.ctx.fiber.store[name];
			};
		}, `ctx.provide(${JSON.stringify(name)})`);
	}
	/**
	* Re-evaluate every fiber that requires one of the given services.
	*
	* @param names — the service names that changed.
	* @param filter — restricts notification to matching isolation scopes.
	* @returns the fibers whose dependency state was refreshed.
	*/
	notify(names, filter = (ctx, name) => ctx[symbols.isolate][name] === this.ctx[symbols.isolate][name]) {
		const fibers = [];
		for (const runtime of this.ctx.registry.values()) for (const fiber of runtime.fibers) {
			let hasUpdate = false;
			for (const name of names) {
				if (!(name in fiber.inject)) continue;
				if (!filter(fiber.ctx, name)) continue;
				hasUpdate = true;
				fiber._checkImpl(name);
			}
			if (!hasUpdate) continue;
			fiber._refresh();
			fibers.push(fiber);
		}
		for (const name of names) {
			const self = Object.create(this.ctx);
			self[symbols.filter] = (target) => filter(target, name);
			this.ctx.events.emit(self, "internal/service", name, this._getImpl(name, false)?.value);
		}
		return fibers;
	}
	/**
	* Define a computed context property backed by get/set hooks.
	*
	* @param name — the context property name.
	* @param options — the `get` hook and optional `set` hook.
	* @returns a disposer that removes the accessor.
	*/
	accessor(name, options) {
		return this.ctx.fiber.effect(() => {
			if (name in this.props) throw new Error(`property "${name}" is already declared as ${this.props[name].type}`);
			this.props[name] = {
				type: "accessor",
				...options
			};
			return () => delete this.props[name];
		}, `ctx.accessor(${JSON.stringify(name)})`);
	}
	/**
	* Expose selected members of a service directly on `ctx`.
	*
	* See the `ctx.mixin()` overload above for the full contract.
	*
	* @param source — a context property name or a source object.
	* @param mixins — keys to forward, or a source-key → ctx-key map.
	* @returns a disposer that removes all created accessors.
	*/
	mixin(source, mixins) {
		const self = this;
		return this.ctx.fiber.effect(function* () {
			const entries = Array.isArray(mixins) ? mixins.map((key) => [key, key]) : Object.entries(mixins);
			const getTarget = (ctx, error) => {
				return ctx[source];
			};
			for (const [key, value] of entries) yield self.accessor(value, {
				get(receiver, error) {
					const service = getTarget(this, error);
					if (isNullable(service)) return service;
					const mixin = receiver ? withProps(receiver, service) : service;
					const value = Reflect.get(service, key, mixin);
					if (typeof value !== "function") return value;
					return value.bind(mixin ?? service);
				},
				set(value, receiver, error) {
					const service = getTarget(this, error);
					const mixin = receiver ? withProps(receiver, service) : service;
					return Reflect.set(service, key, value, mixin);
				}
			});
		}, `ctx.mixin(${JSON.stringify(source)})`);
	}
	/**
	* Attach this context's tracing wrapper to a value.
	*
	* @param value — the value to wrap.
	* @returns the traceable wrapper (or the value itself when not applicable).
	*/
	trace(value) {
		return getTraceable(this.ctx, value);
	}
	/**
	* Wrap a callback so calls trace `this` and arguments to this context.
	*
	* @param callback — the function to wrap.
	* @returns a proxy delegating to `callback` with traced values.
	*/
	bind(callback) {
		return new Proxy(callback, {
			apply: (target, thisArg, args) => {
				return Reflect.apply(target, this.trace(thisArg), args.map((arg) => this.trace(arg)));
			},
			construct: (target, args, newTarget) => {
				return Reflect.construct(target, args.map((arg) => this.trace(arg)), newTarget);
			}
		});
	}
};
const kValidationError = Symbol.for("ValidationError");
/** Error raised when plugin configuration fails standard-schema validation. */
var ValidationError = class extends TypeError {
	name = "ValidationError";
	/**
	* Build the aggregated message from schema issues.
	*
	* @param issues — the standard-schema issues, one message line each.
	*/
	constructor(issues) {
		super(`invalid config:\n` + issues.map((issue) => {
			if (issue.path) return `  - ${issue.message} (at ${issue.path.join(".")})`;
			else return `  - ${issue.message}`;
		}).join("\n"));
	}
};
Object.defineProperty(ValidationError.prototype, kValidationError, { value: true });
/**
* Validate and normalize config for a plugin runtime before it starts.
*
* @param runtime — the plugin runtime whose `Config` schema to apply.
* @param config — the raw user config.
* @returns the validated config, or `config` unchanged if the runtime has no schema.
* @throws {ValidationError} when validation reports issues.
*/
function resolveConfig$1(runtime, config) {
	if (!runtime.Config) return config;
	const result = runtime.Config["~standard"].validate(config);
	if ("then" in result) throw new TypeError("Async config validation is not supported");
	if (result.issues) throw new ValidationError(result.issues);
	else return result.value;
}
const effectInertia = /* @__PURE__ */ new WeakMap();
function runDisposable(dispose) {
	const result = dispose();
	return effectInertia.get(dispose)?.() ?? result;
}
/** Notify plugin teardown without allowing one observer to break ownership cleanup. */
function emitPluginDisposed(context, fiber) {
	const args = ["internal/plugin", fiber];
	let callbacks;
	try {
		callbacks = context.events.dispatch("emit", args);
	} catch (error) {
		context.logger.error(error);
		return;
	}
	for (const callback of callbacks) try {
		const returned = callback(...args);
		Promise.resolve(returned).catch((error) => context.logger.error(error));
	} catch (error) {
		context.logger.error(error);
	}
}
/** Framework error with a stable machine-readable code. */
var CordisError = class CordisError extends Error {
	code;
	/**
	* @param code — the stable error code; also the default message.
	* @param message — optional human-readable override.
	*/
	constructor(code, message) {
		super(message ?? CordisError.Code[code]);
		this.code = code;
	}
};
/** Cordis error code definitions. */
(function(CordisError) {
	CordisError.Code = { INACTIVE_EFFECT: "cannot create effect on inactive context" };
})(CordisError || (CordisError = {}));
const INACTIVE = "__INACTIVE__";
/**
* Runtime instance of one plugin application.
*
* A fiber tracks dependency state, validated config, lifecycle effects, and
* cleanup for the plugin context returned by `ctx.plugin()`.
*/
var Fiber = class {
	parent;
	inject;
	runtime;
	/** Unique id within the registry; 0 for the root fiber, `null` once disposed. */
	uid;
	/** The context this fiber's plugin runs in (extends the parent context). */
	ctx;
	/** The validated plugin config (updated by `update()`). */
	config;
	/** The raw plugin config, re-resolved before each activation. */
	_config;
	/** Current lifecycle state; transitions emit `internal/status`. */
	state = 0;
	/** Dispose this fiber: unload the plugin, then settle once cleanup finished. */
	dispose;
	/** Snapshot of required service implementations while loaded; `undefined` otherwise. */
	store;
	/** The in-flight load/unload transition, if one is currently running. */
	inertia;
	_hooks = Object.create(null);
	_disposables = new DisposableList();
	context;
	_error;
	_runner;
	_store = Object.create(null);
	/**
	* Create a fiber. Plugin authors normally obtain fibers from `ctx.plugin()`
	* rather than constructing them directly.
	*
	* @param parent — the context the plugin was loaded from.
	* @param config — raw config, validated against the runtime's schema.
	* @param inject — resolved dependency map (service name → intercept config).
	* @param runtime — the shared plugin runtime, or `null` for the root fiber.
	* @param getOuterStack — captures the caller stack for effect diagnostics.
	*/
	constructor(parent, config, inject, runtime, getOuterStack) {
		this.parent = parent;
		this.inject = inject;
		this.runtime = runtime;
		this._config = config;
		const collect = (dispose) => {
			this._disposables.push(dispose);
		};
		if (runtime) {
			this.uid = parent.registry.counter;
			this.ctx = this.context = parent.extend({ fiber: this });
			const injectEntries = Object.entries(this.inject);
			if (injectEntries.length) {
				this.ctx[Context.intercept] = Object.create(parent[Context.intercept]);
				for (const [name, config] of injectEntries) {
					if (isNullable(config)) continue;
					this.ctx[Context.intercept][name] = config;
				}
			}
			this._runner = {
				epoch: INACTIVE,
				getOuterStack,
				execute: function() {
					if (isConstructor(runtime.callback)) {
						const instance = new runtime.callback(this.ctx, this.config);
						for (const hook of instance?.[symbols.initHooks] ?? []) hook();
						return instance?.[symbols.init]?.();
					} else return runtime.callback(this.ctx, this.config);
				},
				collect
			};
			this.dispose = parent.fiber.effect(() => {
				const remove = runtime.fibers.push(this);
				return async () => {
					this.uid = null;
					emitPluginDisposed(this.context, this);
					if (this.ctx.registry.has(runtime.callback)) {
						remove();
						if (!runtime.fibers.length) this.ctx.registry.delete(runtime.callback);
					}
					this._setEpoch(INACTIVE);
					if (!this.inertia) this._updateState(() => {
						this.inertia = this._unload();
						return 5;
					});
					while (this.inertia) await this.inertia;
				};
			}, "ctx.plugin()");
			try {
				this.context.emit("internal/plugin", this);
			} catch (error) {
				Promise.resolve(this.dispose()).catch((reason) => this.ctx.logger.error(reason));
				throw error;
			}
			if (this.uid !== null && parent.fiber.state !== 5) {
				for (const name of Object.keys(this.inject)) this._checkImpl(name);
				this._refresh();
			}
		} else {
			this.uid = 0;
			this.ctx = this.context = parent;
			this.state = 2;
			this.store = Object.create(null);
			this._runner = {
				epoch: "",
				getOuterStack,
				execute: () => {},
				collect
			};
			this.dispose = () => this.restart();
		}
	}
	/** The plugin's display name, inherited from the nearest named ancestor, else `'root'`. */
	get name() {
		let fiber = this;
		do {
			if (fiber.runtime?.name) return fiber.runtime.name;
			fiber = fiber.parent.fiber;
		} while (fiber !== fiber.parent.fiber);
		return "root";
	}
	/**
	* Throw if the fiber has already been disposed.
	*
	* @returns nothing when the fiber is still active.
	* @throws {CordisError} `INACTIVE_EFFECT` when the fiber's uid has been cleared.
	*/
	assertActive() {
		if (this.uid !== null) return;
		throw new CordisError("INACTIVE_EFFECT");
	}
	_execute(runner) {
		const oldEpoch = runner.epoch;
		return composeError((info) => {
			const safeCollect = (dispose) => {
				if (typeof dispose === "function") runner.collect(dispose);
				else if (!isNullable(dispose)) throw new TypeError("Invalid effect");
			};
			const effect = runner.execute.call(this);
			if (typeof effect === "function") return runner.collect(effect);
			else if (isNullable(effect)) {} else if (!isObject(effect)) throw new TypeError("Invalid effect");
			else if ("then" in effect) return effect.then(safeCollect);
			else if (Symbol.iterator in effect) {
				info.error = /* @__PURE__ */ new Error();
				const iter = effect[Symbol.iterator]();
				while (true) {
					const result = iter.next();
					safeCollect(result.value);
					if (result.done) return;
				}
			} else if (Symbol.asyncIterator in effect) {
				const iter = effect[Symbol.asyncIterator]();
				return (async () => {
					await Promise.resolve();
					info.error = /* @__PURE__ */ new Error();
					while (true) {
						if (runner.epoch !== oldEpoch) return;
						const result = await iter.next();
						safeCollect(result.value);
						if (result.done) return;
					}
				})();
			} else throw new TypeError("Invalid effect");
		}, runner.getOuterStack);
	}
	effect(execute, label = "anonymous") {
		this.assertActive();
		if (this.state === 5) throw new CordisError("INACTIVE_EFFECT");
		const disposables = [];
		let disposing = false;
		let disposalTask;
		const dispose = () => {
			if (disposing) return disposalTask;
			disposing = true;
			let task;
			for (const disposable of disposables.splice(0).reverse()) if (task) task = task.then(() => runDisposable(disposable));
			else {
				const result = runDisposable(disposable);
				if (isObject(result) && "then" in result) task = result;
			}
			return disposalTask = task;
		};
		const meta = {
			label,
			children: []
		};
		const runner = {
			execute,
			epoch: true,
			collect: (dispose) => {
				disposables.push(dispose);
				this._disposables.delete(dispose);
				if (dispose[symbols.effect]) meta.children.push(dispose[symbols.effect]);
			},
			getOuterStack: buildOuterStack()
		};
		let task;
		let executing = true;
		let resolveSetup;
		let rejectSetup;
		let setupBarrier;
		let setupFailed = false;
		let inFlight;
		let removeWrapper = () => false;
		const waitForSetup = () => {
			setupBarrier ??= new Promise((resolve, reject) => {
				resolveSetup = resolve;
				rejectSetup = reject;
			});
			return setupBarrier;
		};
		const disposeAfter = (setup) => {
			return Promise.resolve(setup).then(() => dispose(), async (reason) => {
				await dispose();
				throw reason;
			});
		};
		const finalizeDisposal = (callback) => {
			let result;
			try {
				result = callback();
			} catch (error) {
				removeWrapper();
				throw error;
			}
			if (isObject(result) && "then" in result) {
				const pending = Promise.resolve(result).finally(() => {
					removeWrapper();
					if (inFlight === pending) inFlight = void 0;
				});
				return inFlight = pending;
			}
			removeWrapper();
			return result;
		};
		const wrapper = defineProperty(() => {
			if (!runner.epoch) return setupFailed ? inFlight : void 0;
			runner.epoch = false;
			return finalizeDisposal(() => {
				if (executing) return disposeAfter(waitForSetup());
				return task ? disposeAfter(task) : dispose();
			});
		}, symbols.effect, meta);
		effectInertia.set(wrapper, () => inFlight);
		removeWrapper = this._disposables.push(wrapper);
		try {
			task = this._execute(runner);
		} catch (reason) {
			executing = false;
			setupFailed = true;
			runner.epoch = false;
			let cleanup;
			try {
				cleanup = finalizeDisposal(dispose);
			} finally {
				rejectSetup?.(reason);
			}
			if (isObject(cleanup) && "then" in cleanup) cleanup.catch((error) => this.ctx.logger.error(error));
			throw reason;
		}
		executing = false;
		if (setupBarrier) Promise.resolve(task).then(resolveSetup, rejectSetup);
		task?.catch(() => {
			if (!runner.epoch) return dispose();
			return finalizeDisposal(dispose);
		}).catch((error) => this.ctx.logger.error(error));
		const disposeAsync = () => {
			if (!runner.epoch) return;
			runner.epoch = false;
			return finalizeDisposal(dispose);
		};
		wrapper.then = async (onFulfilled, onRejected) => {
			return Promise.resolve(task).then(() => disposeAsync).then(onFulfilled, onRejected);
		};
		return wrapper;
	}
	/**
	* Return metadata for currently registered effects.
	*
	* @returns one {@link EffectMeta} tree per labeled live effect.
	*/
	getEffects() {
		return [...this._disposables].map((dispose) => dispose[symbols.effect]).filter(Boolean);
	}
	_getState() {
		if (this.uid === null) return 4;
		if (this._error) return 3;
		if (this._runner.epoch !== INACTIVE) return 2;
		return 0;
	}
	_updateState(callback) {
		const oldState = this.state;
		this.state = callback() ?? this._getState();
		if (oldState === this.state) return;
		this.context.emit("internal/status", this, oldState);
		if (oldState !== 2 && this.state !== 2) return;
		for (const key of Reflect.ownKeys(this.ctx.reflect.store)) {
			const impl = this.ctx.reflect.store[key];
			if (impl.fiber !== this) continue;
			this.ctx.reflect.notify([impl.name]);
		}
	}
	_checkImpl(name) {
		const impl = this.ctx.reflect._getImpl(name, true);
		if (!impl) return delete this._store[name];
		try {
			if (impl.check && !impl.check.call(getTraceable(this.ctx, impl.value))) return delete this._store[name];
		} catch (error) {
			impl.fiber.ctx.logger.error(error);
			return delete this._store[name];
		}
		this._store[name] = impl;
	}
	_refresh() {
		let epoch = false;
		epoch = "";
		for (const name of Object.keys(this.inject)) {
			const impl = this._store[name];
			if (!impl) {
				epoch = INACTIVE;
				break;
			}
			epoch += ":" + impl.fiber.uid;
		}
		this._setEpoch(epoch);
	}
	_setEpoch(epoch) {
		const oldEpoch = this._runner.epoch;
		if (epoch === oldEpoch) return;
		this._runner.epoch = epoch;
		if (this.inertia) return;
		this._updateState(() => {
			if (epoch !== INACTIVE && oldEpoch === INACTIVE) {
				this.inertia = this._reload();
				return 1;
			} else {
				this.inertia = this._unload();
				return 5;
			}
		});
	}
	_resolveConfig(config) {
		config = this.context.waterfall(this, "internal/config", config, () => config);
		return this.runtime ? resolveConfig$1(this.runtime, config) : config;
	}
	async _reload() {
		this.store = { ...this._store };
		const oldEpoch = this._runner.epoch;
		try {
			await Promise.resolve();
			if (this._runner.epoch === oldEpoch) {
				this.config = this._resolveConfig(this._config);
				await this._execute(this._runner);
				this._error = void 0;
			}
		} catch (reason) {
			this.ctx.logger.error(reason);
			this._error = reason;
			this._runner.epoch = INACTIVE;
		}
		this._updateState(() => {
			if (this._runner.epoch === oldEpoch) this.inertia = void 0;
			else {
				this.inertia = this._unload();
				return 5;
			}
		});
	}
	async _unload() {
		await Promise.all(this._disposables.clear().map(async (dispose) => {
			try {
				await composeError(async (info) => {
					await Promise.resolve();
					info.error = /* @__PURE__ */ new Error();
					await runDisposable(dispose);
				}, this._runner.getOuterStack);
			} catch (reason) {
				this.ctx.logger.error(reason);
			}
		}));
		this.store = void 0;
		this._updateState(() => {
			if (this._runner.epoch === INACTIVE) this.inertia = void 0;
			else {
				this.inertia = this._reload();
				return 1;
			}
		});
	}
	/**
	* Wait for current lifecycle work and rethrow startup errors.
	*
	* @returns this fiber, once it has settled into a stable state.
	* @throws the config-validation or plugin-startup error, if any.
	*/
	async await() {
		while (this.inertia) await this.inertia;
		if (this._error) throw this._error;
		return this;
	}
	/**
	* Dispose and immediately reload this plugin with its current config.
	*
	* @returns a promise resolving once the reload settled.
	* @throws {CordisError} `INACTIVE_EFFECT` when the fiber is already disposed.
	*/
	async restart() {
		this.assertActive();
		this._setEpoch(INACTIVE);
		this._refresh();
		await this.await();
	}
	/**
	* Validate and apply new config, then restart the plugin.
	*
	* Runs the `internal/update` waterfall first, so update hooks (and HMR)
	* can veto or replace the restart.
	*
	* @param config — the new raw config; validated before anything restarts.
	* @param noSave — hint for persistence hooks not to write the change back.
	* @returns the update waterfall result; the default restart returns a promise.
	* @throws when validation, an update listener, or the restarted plugin fails.
	*/
	update(config, noSave = false) {
		this.assertActive();
		this._config = config;
		if (this.state !== 2) {
			this._error = void 0;
			this._setEpoch(INACTIVE);
			this._refresh();
			return;
		}
		config = this._resolveConfig(config);
		return this.context.waterfall(this, "internal/update", config, noSave, () => {
			this.config = config;
			this._error = void 0;
			return this.restart();
		});
	}
};
function isApplicable(object) {
	return object && typeof object === "object" && typeof object.apply === "function";
}
/**
* Decorator for declaring service dependencies on classes or class methods.
*
* On classes it contributes to the plugin's static `inject` map. On methods it
* delays the method call until the declared services are available.
*/
/**
* @param name — the required service name.
* @param config — optional intercept config applied for that service.
* @returns the class or method decorator.
*/
function Inject(name, config) {
	return function(value, decorator) {
		if (decorator.kind === "class") {
			if (!Object.hasOwn(value, "inject")) {
				defineProperty(value, "inject", Object.create(Object.getPrototypeOf(value).inject ?? null));
				defineProperty(value.inject, symbols.checkProto, true);
			}
			value.inject[name] = config;
		} else if (decorator.kind === "method") {
			const inject = (value[symbols.metadata] ??= {}).inject ??= Object.create(null);
			inject[name] = config;
			decorator.addInitializer(function() {
				const property = this[symbols.tracker]?.property;
				(this[symbols.initHooks] ??= []).push(() => {
					this.ctx.inject(inject, (ctx) => {
						return value.call(property ? withProps(this, { [property]: ctx }) : this);
					});
				});
			});
		} else throw new Error("@Inject() can only be used on class or class methods");
	};
}
/** Utilities for normalizing plugin dependency declarations. */
(function(Inject) {
	/**
	* Convert array/object/class-inherited inject metadata into a plain map.
	*
	* @param inject — the declaration to normalize; `null`/`undefined` add nothing.
	* @param result — the map to fill (service name → intercept config or `null`).
	* @returns `result`.
	*/
	function resolve(inject, result = Object.create(null)) {
		if (!inject) return result;
		if (Array.isArray(inject)) for (const name of inject) result[name] = null;
		else if (Reflect.has(inject, symbols.checkProto)) {
			Object.assign(result, resolve(Object.getPrototypeOf(inject)));
			for (const name of Object.keys(inject)) result[name] = inject[name] ?? null;
		} else for (const name of Object.keys(inject)) result[name] = inject[name] ?? null;
		return result;
	}
	Inject.resolve = resolve;
})(Inject || (Inject = {}));
/**
* Plugin registry installed as `ctx.registry` and mixed into every context.
*
* It normalizes plugin shapes, tracks plugin runtimes, starts fibers, and
* exposes map-like inspection over active plugin callbacks.
*/
var RegistryService = class {
	ctx;
	_counter = 0;
	_internal = /* @__PURE__ */ new Map();
	constructor(ctx) {
		this.ctx = ctx;
		defineProperty(this, symbols.tracker, {
			property: "ctx",
			noShadow: true
		});
	}
	/** Allocate the next fiber uid (increments on every read). */
	get counter() {
		return ++this._counter;
	}
	/** Number of registered plugin runtimes. */
	get size() {
		return this._internal.size;
	}
	/**
	* Resolve a supported plugin shape to its executable callback.
	*
	* @param plugin — a function, class, or `{ apply }` object plugin.
	* @returns the callback identifying the plugin, or `undefined` if invalid.
	*/
	resolve(plugin) {
		try {
			if (typeof plugin === "function") return plugin;
			if (isApplicable(plugin)) return plugin.apply;
		} catch {}
	}
	/**
	* Look up the runtime record for a plugin.
	*
	* @param plugin — any supported plugin shape.
	* @returns the runtime, or `undefined` when the plugin is not registered.
	*/
	get(plugin) {
		const key = this.resolve(plugin);
		return key && this._internal.get(key);
	}
	/**
	* Check whether a plugin has a registered runtime.
	*
	* @param plugin — any supported plugin shape.
	* @returns `true` when at least one fiber of the plugin exists.
	*/
	has(plugin) {
		const key = this.resolve(plugin);
		return !!key && this._internal.has(key);
	}
	/**
	* Dispose every running fiber for a plugin and remove its runtime record.
	*
	* @param plugin — any supported plugin shape.
	* @returns the removed runtime, or `undefined` when none was registered.
	*/
	delete(plugin) {
		const key = this.resolve(plugin);
		const runtime = key && this._internal.get(key);
		if (!runtime) return;
		this._internal.delete(key);
		for (const fiber of runtime.fibers) fiber.dispose();
		return runtime;
	}
	/** Iterate the registered plugin callbacks. */
	keys() {
		return this._internal.keys();
	}
	/** Iterate the registered plugin runtimes. */
	values() {
		return this._internal.values();
	}
	/** Iterate `[callback, runtime]` pairs. */
	entries() {
		return this._internal.entries();
	}
	/**
	* Visit every registered runtime.
	*
	* @param callback — receives each runtime and its identifying callback.
	*/
	forEach(callback) {
		return this._internal.forEach(callback);
	}
	/**
	* Start a callback once the requested dependencies are available.
	*
	* @param inject — required services, as an array or a name → config map.
	* @param callback — plugin body called with `(ctx, config)`.
	* @returns the fiber; awaiting it settles once loading finished.
	*/
	inject(inject, callback) {
		return this.plugin({
			inject,
			apply: callback,
			name: callback.name
		});
	}
	/**
	* Start a plugin in the current context and return its fiber.
	*
	* Creates (or reuses) the plugin's runtime record, then starts a new fiber
	* under the current context. Throws if `plugin` is not a supported shape or
	* if the current fiber is already disposed.
	*
	* @param plugin — a function, class, or `{ apply }` object plugin.
	* @param config — the plugin config, validated against its `Config` schema.
	* @param getOuterStack — captures the caller stack for effect diagnostics.
	* @returns the fiber; awaiting it settles once loading finished.
	*/
	plugin(plugin, config, getOuterStack = buildOuterStack()) {
		const callback = this.resolve(plugin);
		if (!callback) throw new Error("invalid plugin, expect function or object with an \"apply\" method, received " + typeof plugin);
		this.ctx.fiber.assertActive();
		let runtime = this._internal.get(callback);
		if (!runtime) {
			let name = plugin.name;
			if (name === "apply") name = void 0;
			runtime = {
				name,
				callback,
				fibers: new DisposableList(),
				Config: plugin.Config
			};
			this._internal.set(callback, runtime);
		}
		const fiber = new Fiber(this.ctx, config, Inject.resolve(plugin.inject), runtime, getOuterStack);
		const wrapped = Object.create(fiber);
		wrapped.then = (onFulfilled, onRejected) => {
			return fiber.await().then(onFulfilled, onRejected);
		};
		return wrapped;
	}
};
/**
* Root and child dependency containers for Cordis plugins.
*
* A context is a proxy: normal property reads go through the service resolver,
* while `extend()`, `isolate()`, and `intercept()` create scoped child
* contexts without mutating their parent.
*/
var Context = class Context {
	/** Symbol key under which a disposer exposes its {@link EffectMeta} diagnostics tree. */
	static effect = symbols.effect;
	/** Symbol key for a context's listener filter, consulted on every event dispatch. */
	static filter = symbols.filter;
	/** Symbol key of the isolation map (see the `Context[symbols.isolate]` property). */
	static isolate = symbols.isolate;
	/** Symbol key of the intercept map (see the `Context[symbols.intercept]` property). */
	static intercept = symbols.intercept;
	/**
	* Returns true for Cordis context proxies and context prototypes.
	*
	* Works across realms and across multiple copies of cordis, because the
	* brand is keyed by a global symbol rather than by `instanceof`.
	*
	* @param value — the value to test.
	* @returns `true` if `value` is a Cordis context, narrowing its type.
	*/
	static is(value) {
		return !!value?.[Context.is];
	}
	static {
		Context.is[Symbol.toPrimitive] = () => Symbol.for("cordis.is");
		Context.prototype[Context.is] = true;
	}
	/** Create the root context and install the built-in services. */
	constructor() {
		this[symbols.isolate] = Object.create(null);
		this[symbols.intercept] = Object.create(null);
		const self = new Proxy(this, ReflectService.handler);
		this.root = self;
		this.baseUrl = void 0;
		this.fiber = new Fiber(self, {}, Object.create(null), null, () => []);
		this.reflect = new ReflectService(self);
		this.registry = new RegistryService(self);
		this.events = new EventsService(self);
		this.logger = new LoggerService(self);
		this.fiber._disposables.clear();
		return self;
	}
	[Symbol.for("nodejs.util.inspect.custom")]() {
		return `Context <${this.fiber.name}>`;
	}
	/**
	* Create a child context with extra metadata on top of the current scope.
	*
	* The child prototypally inherits every property of this context; own
	* properties of `meta` shadow the inherited ones. The parent is not mutated.
	*
	* @param meta — own properties (including symbol keys) to define on the child.
	* @returns a child context inheriting from this one.
	*/
	extend(meta = {}) {
		const shadow = Reflect.getOwnPropertyDescriptor(this, symbols.shadow)?.value;
		const self = Object.create(getTraceable(this, this));
		for (const prop of Reflect.ownKeys(meta)) Object.defineProperty(self, prop, Reflect.getOwnPropertyDescriptor(meta, prop));
		if (!shadow) return self;
		return Object.assign(Object.create(self), { [symbols.shadow]: shadow });
	}
	/**
	* Create a child context with an independent service scope for `name`.
	*
	* Below the returned context, reads and writes of the service `name`
	* resolve against the new label instead of the parent's, so a different
	* implementation can be provided without affecting the parent scope.
	* Passing the same `label` to two `isolate()` calls joins their scopes.
	*
	* @param name — the service name to isolate.
	* @param label — scope label to join; defaults to a fresh unique symbol.
	* @returns a child context whose `name` service resolves in the new scope.
	*/
	isolate(name, label) {
		const shadow = Object.create(this[symbols.isolate]);
		shadow[name] = label ?? Symbol(name);
		return this.extend({ [symbols.isolate]: shadow });
	}
	intercept(name, config) {
		const intercept = Object.create(this[symbols.intercept]);
		intercept[name] = config;
		return this.extend({ [symbols.intercept]: intercept });
	}
};
/**
* Base class for services that expose a named API on `ctx`.
*
* Subclasses call `super(ctx, name)` from their constructor. The service is
* registered immediately and is automatically removed with the owning fiber.
*/
var Service = class Service {
	ctx;
	/** Symbol key of an instance method run after construction (class plugins). */
	static init = symbols.init;
	/** Symbol key of the availability predicate passed to `ctx.provide()`. */
	static check = symbols.check;
	/** Symbol key of the phantom intercept-config type parameter. */
	static config = symbols.config;
	/** Symbol key of the call body making a service callable (e.g. `ctx.logger()`). */
	static invoke = symbols.invoke;
	/** Symbol key of the helper deriving an extended service instance. */
	static extend = symbols.extend;
	/** Symbol key of the tracker metadata used for context tracing. */
	static tracker = symbols.tracker;
	/** Symbol key of the intercept-config resolution helper below. */
	static resolveConfig = symbols.resolveConfig;
	/** The service name this instance is registered under. */
	name;
	/**
	* Register this instance as `name` in the current context.
	*
	* Calls `ctx.reflect.provide(name, this, this[Service.check])`, so the
	* service is unregistered automatically when the owning fiber unloads.
	* Services with a `[Service.invoke]` body return a callable instance.
	*
	* @param ctx — the context to register in (stored as `this.ctx`).
	* @param name — the service name; defaults to the static `provide` field.
	*/
	constructor(ctx, name) {
		this.ctx = ctx;
		name ??= this.constructor["provide"];
		let self = this;
		const tracker = {
			associate: name,
			property: "ctx"
		};
		if (self[symbols.invoke]) self = createCallable(name, joinPrototype(Object.getPrototypeOf(this), Function.prototype), tracker);
		self.ctx = ctx;
		self.name = name;
		defineProperty(self, symbols.tracker, tracker);
		self.ctx.reflect.provide(name, self, this[symbols.check]);
		return self;
	}
	[symbols.filter](ctx) {
		return ctx[symbols.isolate][this.name] === this.ctx[symbols.isolate][this.name];
	}
	[symbols.extend](props) {
		let self;
		if (this[Service.invoke]) self = createCallable(this.name, this, this[symbols.tracker]);
		else self = Object.create(this);
		return Object.assign(self, props);
	}
	/**
	* Merge intercept config from ancestors with optional base and head values.
	*
	* Entries added closer to the root apply first; `base` is prepended and
	* `head` appended. Uses `Config.merge` when the service declares one,
	* otherwise a shallow `Object.assign`.
	*
	* @param base — lowest-precedence config merged before all intercepts.
	* @param head — highest-precedence config merged after all intercepts.
	* @returns the merged config.
	*/
	[symbols.resolveConfig](base, head) {
		let intercept = this.ctx[Context.intercept];
		const configs = [];
		while (this.name in intercept) {
			if (Object.hasOwn(intercept, this.name)) configs.unshift(intercept[this.name]);
			intercept = Object.getPrototypeOf(intercept);
		}
		if (base) configs.unshift(base);
		if (head) configs.push(head);
		if (this["Config"]?.merge) return this["Config"].merge(...configs);
		else return Object.assign({}, ...configs);
	}
	static [Symbol.hasInstance](instance) {
		if (!instance) return false;
		let constructor = instance.constructor;
		while (constructor) {
			constructor = constructor.prototype?.constructor;
			if (constructor === this) return true;
			constructor &&= Object.getPrototypeOf(constructor);
		}
		return false;
	}
};
//#endregion
//#region ../../deepseek-harness/packages/core/scope/lib/index.js
/**
* Shared insertion-ordered storage and effect ownership for scope-aware registries.
*
* @module @deepseek-ai/dsh-scope
*/
/**
* Insertion-ordered named entries with caller-owned duplicate diagnostics.
*
* Values are borrowed. Iterators are live within one nonempty table
* generation; draining the table detaches them from later insertions. Each
* successful insertion returns an idempotent undo for that exact entry.
*/
var NamedEntries = class {
	duplicateError;
	data = /* @__PURE__ */ new Map();
	constructor(duplicateError) {
		this.duplicateError = duplicateError;
	}
	/**
	* Insert one unique name.
	* @param name - name unique within this table.
	* @param value - borrowed value to retain.
	* @returns an idempotent undo that removes only this insertion.
	*/
	insert(name, value) {
		const data = this.data;
		if (data.has(name)) throw this.duplicateError(name);
		data.set(name, value);
		let active = true;
		return () => {
			if (!active) return;
			active = false;
			data.delete(name);
			if (data.size === 0 && this.data === data) this.data = /* @__PURE__ */ new Map();
		};
	}
	/**
	* Read one named value.
	* @param name - name to resolve.
	* @returns the retained value, or `undefined` when absent.
	*/
	get(name) {
		return this.data.get(name);
	}
	/**
	* Test one name for membership.
	* @param name - name to test.
	* @returns whether the table contains that name.
	*/
	has(name) {
		return this.data.has(name);
	}
	/**
	* Iterate live names in insertion order.
	* @returns the native live key iterator.
	*/
	keys() {
		return this.data.keys();
	}
	/**
	* Iterate live entries in insertion order.
	* @returns the native live entry iterator.
	*/
	entries() {
		return this.data.entries();
	}
	/**
	* Iterate live values in insertion order.
	* @returns the native live value iterator.
	*/
	values() {
		return this.data.values();
	}
	/**
	* Test whether this table has no entries.
	* @returns whether the table is empty.
	*/
	isEmpty() {
		return this.data.size === 0;
	}
};
/**
* Insertion-ordered anonymous entries with independent registration identity.
*
* Equal values remain separate registrations. Values are borrowed, and
* iterators are live within one nonempty table generation; draining the table
* detaches them from later appends.
*/
var AnonymousEntries = class {
	data = /* @__PURE__ */ new Map();
	/**
	* Append one independently owned value.
	* @param value - borrowed value to retain.
	* @returns an idempotent undo for this exact append.
	*/
	append(value) {
		const data = this.data;
		const key = Symbol();
		data.set(key, value);
		let active = true;
		return () => {
			if (!active) return;
			active = false;
			data.delete(key);
			if (data.size === 0 && this.data === data) this.data = /* @__PURE__ */ new Map();
		};
	}
	/**
	* Iterate live values in insertion order.
	* @returns the native live value iterator.
	*/
	values() {
		return this.data.values();
	}
	/**
	* Test whether this table has no entries.
	* @returns whether the table is empty.
	*/
	isEmpty() {
		return this.data.size === 0;
	}
};
/**
* Own the global and exact-scope layers for one registry.
*
* Reads never create scoped layers. Registrations derive both visibility and
* effect ownership from the supplied Cordis context, collect undo before
* notification, and reclaim only a completely empty aggregate layer.
*/
var ScopedLayers = class {
	createLayer;
	onChange;
	/** The eagerly constructed context-global layer. */
	global;
	scoped = /* @__PURE__ */ new Map();
	constructor(createLayer, onChange) {
		this.createLayer = createLayer;
		this.onChange = onChange;
		this.global = createLayer(void 0);
	}
	/**
	* Read an existing exact-scope overlay. Deliberately chain-blind: callers
	* addressing one scope's OWN contributions (its restrictions, its guards)
	* must not silently pick up an ancestor's — use {@link chainLayers} where
	* inheritance is the point.
	* @param scope - exact scope key; `undefined` denotes no overlay.
	* @returns the existing scoped layer, or `undefined` without creating one.
	*/
	peek(scope) {
		if (scope === void 0) return void 0;
		return this.scoped.get(scope);
	}
	/**
	* Existing overlays along the scope's parent chain ({@link scopeChainOf}),
	* farthest ancestor first and the exact scope last, so a caller layering
	* them in order gives the nearest scope the final word.
	* @param scope - viewing scope, or `undefined` for no overlays.
	* @returns the existing layers, nearest last; absent overlays are skipped.
	*/
	chainLayers(scope) {
		const layers = [];
		for (const key of scopeChainOf(scope).reverse()) {
			const layer = this.scoped.get(key);
			if (layer !== void 0) layers.push(layer);
		}
		return layers;
	}
	/**
	* Materialize global named entries followed by scope-chain shadows,
	* farthest ancestor first, so the nearest scope's entry wins a name.
	* @param scope - viewing scope, or `undefined` for the global view.
	* @param pick - select the named table from a layer.
	* @returns an insertion-ordered effective map.
	*/
	merge(scope, pick) {
		const merged = new Map(pick(this.global).entries());
		for (const layer of this.chainLayers(scope)) for (const [name, value] of pick(layer).entries()) merged.set(name, value);
		return merged;
	}
	/**
	* Attach one synchronous layer mutation to its registration context.
	* @param ctx - context that determines both scope visibility and effect ownership.
	* @param action - atomic mutation returning its synchronous undo.
	* @param options - Cordis effect label and optional change notification.
	* @returns the exact disposer returned by `ctx.effect()`.
	*/
	effect(ctx, action, options) {
		const scope = scopeOf(ctx);
		const notify = options.notify ?? true;
		return ctx.effect(function* () {
			let layer;
			let created = false;
			if (scope === void 0) layer = this.global;
			else {
				const existing = this.scoped.get(scope);
				if (existing === void 0) {
					layer = this.createLayer(scope);
					this.scoped.set(scope, layer);
					created = true;
				} else layer = existing;
			}
			let undo;
			try {
				undo = action(layer);
			} catch (error) {
				if (scope !== void 0 && created && layer.isEmpty()) this.scoped.delete(scope);
				throw error;
			}
			yield () => {
				undo();
				if (scope !== void 0 && layer.isEmpty()) this.scoped.delete(scope);
				if (notify) this.onChange();
			};
			if (notify) this.onChange();
		}.bind(this), options.label);
	}
};
/**
* Scoped-context primitive: mint a Cordis context that tags registrations with
* an opaque identity and build routing-only event carriers for that identity.
*
* @module @deepseek-ai/dsh-scope
*/
/** Context tag written by {@link createScope}. */
const kScope = Symbol("dsh.scope");
/** The key associated with each carrier. Presence distinguishes an unkeyed carrier from a non-carrier. */
const carrierKeys = /* @__PURE__ */ new WeakMap();
/**
* The enclosing scope of each key. One relation powers both directions of
* scope nesting: registration views inherit DOWN the chain (a child scope
* sees its ancestors' layers — {@link ScopedLayers}), and event admission
* extends UP it (a listener tagged with an ancestor receives events dispatched
* to a descendant key — {@link scopeTarget}).
*/
const scopeParents = /* @__PURE__ */ new WeakMap();
/**
* The chain from a key to its root ancestor.
* @param key - the starting key, or `undefined` for the empty chain.
* @returns keys nearest-first: `[key, parent, grandparent, …]`.
*/
function scopeChainOf(key) {
	const chain = [];
	for (let cursor = key; cursor !== void 0; cursor = scopeParents.get(cursor)) chain.push(cursor);
	return chain;
}
/**
* Read the nearest scope tag inherited by a context.
* @param ctx - context to inspect.
* @returns its scope key, or `undefined` for an unscoped context.
*/
function scopeOf(ctx) {
	return ctx[kScope];
}
/**
* Build an opaque receiver that preserves the base filter, admits untagged
* listeners globally, and admits tagged listeners for a matching key or any
* of its ancestors ({@link bindScopeParent}): a listener owned by an enclosing
* scope receives every descendant scope's events, which is what lets one
* standing composition observe each of the agents composed under it. A tag
* BELOW the dispatch key stays excluded — events flow up the chain, never
* down.
* @param base - subject or service whose existing Cordis filter is preserved.
* @param key - routed scope identity, or `undefined` for an unscoped subject.
* @returns a carrier whose subject remains available only through event arguments.
*/
function scopeTarget(base, key) {
	const baseFilter = base[Context.filter];
	const carrier = { [Context.filter](ctx) {
		if (baseFilter !== void 0 && !baseFilter.call(base, ctx)) return false;
		const tag = scopeOf(ctx);
		if (tag === void 0) return true;
		for (let cursor = key; cursor !== void 0; cursor = scopeParents.get(cursor)) if (cursor === tag) return true;
		return false;
	} };
	carrierKeys.set(carrier, key);
	return carrier;
}
//#endregion
//#region ../../deepseek-harness/packages/util/timeout/lib/index.js
/** Largest delay Node schedules without clamping it to one millisecond. */
const MAX_TIMER_DELAY_MS = 2147483647;
//#endregion
//#region ../../deepseek-harness/packages/llm/llm/lib/index.js
/**
* dsh-llm's owned branded ids: tool-call correlation and provider request
* diagnostics.
*
* The `Branded<B>` primitive itself lives in `@deepseek-ai/dsh-brand` (a
* zero-dependency type-only package) so every owner of a cross-boundary id can
* brand it without depending on dsh-llm; see that package's README for the
* nominal-typing policy.
*
* @module @deepseek-ai/dsh-llm/brand
*/
/**
* Brand a message identifier.
* @param id - the opaque message identifier.
* @returns the same string, branded; no validation is performed.
*/
function MessageId(id) {
	return id;
}
/**
* Brand a string as a {@link CallId}.
* @param id - the provider-issued (or synthesized) call id.
* @returns the same string, branded; no validation is performed.
*/
function CallId(id) {
	return id;
}
/**
* Deep-freeze a value in place with an iterative traversal, guarding cycles,
* so later mutation throws without imposing a JavaScript call-stack depth cap.
* {@link AbortSignal} objects are deliberately skipped because they are the
* request's live cancellation channel and freezing them breaks abort.
* @param value - the value to freeze in place.
* @returns the same value, frozen.
*/
function deepFreeze$1(value) {
	const seen = /* @__PURE__ */ new WeakSet();
	const pending = [{
		kind: "visit",
		node: value
	}];
	while (pending.length > 0) {
		const task = pending.pop();
		/* v8 ignore next -- the loop condition guarantees one pending task. */
		if (task === void 0) continue;
		if (task.kind === "property") {
			pending.push({
				kind: "visit",
				node: task.source[task.key]
			});
			continue;
		}
		const node = task.node;
		if (node === null || typeof node !== "object") continue;
		if (node instanceof AbortSignal) continue;
		if (seen.has(node)) continue;
		seen.add(node);
		Object.freeze(node);
		const keys = Object.keys(node);
		for (let index = keys.length - 1; index >= 0; index--) {
			const key = keys[index];
			/* v8 ignore next -- the loop is bounded by the captured key count. */
			if (key === void 0) continue;
			pending.push({
				kind: "property",
				source: node,
				key
			});
		}
	}
	return value;
}
/**
* Detach and deep-freeze a message whose identity already exists.
* @param message - complete message, including its stable identity.
* @returns an immutable snapshot that preserves the identity.
*/
function freezeMessage(message) {
	return deepFreeze$1(structuredClone(message));
}
/**
* Create one identified message and freeze it before publication.
* @param input - complete role, content, and source for a new message.
* @returns an immutable message with a fresh stable identity.
*/
function createMessage(input) {
	return freezeMessage({
		...input,
		id: MessageId(crypto.randomUUID())
	});
}
/**
* Create one identified user-role message and freeze it before publication.
* @param input - complete content and source for a new user message.
* @returns an immutable user message with a fresh stable identity.
*/
function createUserMessage(input) {
	return createMessage({
		...input,
		role: "user"
	});
}
/**
* Harness error base with a stable machine-routable code and chained cause.
* Package errors extend it so tool results and replay can retain failure class.
* @module @deepseek-ai/dsh-llm/error
*/
/**
* Base class for all harness errors. Carries a `code` (stable, programmatic —
* e.g. `NO_ADAPTER`, `INVALID_ARGS`, `INVARIANT`) distinct from the
* human-readable `message`, and supports `cause` chaining via the standard
* `ErrorOptions`. `name` defaults to the subclass constructor name.
*/
var HarnessError = class extends Error {
	/** Stable machine-routable failure class (e.g. `RATE_LIMIT`); route on this, never by parsing `message`. */
	code;
	constructor(message, code, options) {
		super(message, options);
		this.code = code;
		this.name = new.target.name;
	}
};
/**
* Canonical provider-neutral code for a response that completed normally but
* carried no content blocks at all. Providers occasionally emit a degenerate
* completion (a terminal stop with zero output); adapters classify it as this
* failure instead of yielding an empty assistant message, because an empty
* message silently ends the turn with nothing for the user or the loop to act
* on. The attempt produced nothing durable, so retry policy treats it as safe
* to repeat.
*/
const EMPTY_RESPONSE_CODE = "EMPTY_RESPONSE";
new RegExp(String.raw`(?:^|[^a-z0-9])context[\s_-](?:length|window)[\s_-]` + String.raw`(?:exceed(?:ed|s)?|overflow(?:ed)?|limit[\s_-]exceeded)(?:$|[^a-z0-9])`, "i");
new RegExp(String.raw`\b(?:request|prompt|input|messages?)\s+(?:is\s+|are\s+)?` + String.raw`too\s+(?:large|long)\s+for\s+(?:(?:this|the)\s+)?` + String.raw`(?:model(?:'s)?\s+)?context(?:\s+window)?\b`, "i");
new RegExp(String.raw`\b(?:input|prompt|request|messages?)\b.{0,40}` + String.raw`\b(?:exceed(?:s|ed)?|overflows?|is\s+larger\s+than)\b.{0,40}` + String.raw`\b(?:the\s+)?(?:model(?:'s)?\s+)?context(?:\s+(?:length|window))?\b`, "i");
/**
* Provider-owned request-retry policy configuration and resolution.
*
* Adapters expose one resolved policy per registered provider route; the
* optional dsh-llm-retry plugin executes it on the agent's failed-step extension point.
*
* @module @deepseek-ai/dsh-llm/retry-policy
*/
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_INITIAL_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 1e4;
const DEFAULT_JITTER_RATIO = .1;
const DEFAULT_RETRYABLE_CODES = Object.freeze([
	EMPTY_RESPONSE_CODE,
	"RATE_LIMIT",
	"SERVER",
	"TIMEOUT",
	"TRANSPORT"
]);
const backoffSchema = Schema.object({
	initialDelayMs: Schema.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_INITIAL_DELAY_MS),
	maxDelayMs: Schema.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_MAX_DELAY_MS),
	jitterRatio: Schema.number().min(0).max(1).default(DEFAULT_JITTER_RATIO)
});
const normalPolicySchema = Schema.object({
	mode: Schema.const("normal").required(),
	maxRetries: Schema.number().step(1).min(0).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_MAX_RETRIES),
	retryableCodes: Schema.array(Schema.string()).default([...DEFAULT_RETRYABLE_CODES]),
	backoff: backoffSchema
});
const alwaysPolicySchema = Schema.object({
	mode: Schema.const("always").required(),
	backoff: backoffSchema
});
Schema.union([normalPolicySchema, alwaysPolicySchema]);
/**
* Centralize the non-secret product identity every provider request sends as `User-Agent`, keeping
* adapters from drifting. See
* `.agents/notes/implemented/architecture/2026-06-21-mandatory-app-attribution-headers.md`.
*
* App-attribution vocabulary for provider requests.
* @module @deepseek-ai/dsh-llm/attribution
*/
const { version } = createRequire(import.meta.url)("../package.json");
/**
* Exhaustiveness helper for closed core unions. Use {@link assertNever} at the default branch so a
* new variant fails compilation at every required handler. Do not use it for declaration-merged
* unions such as session events or content blocks: handle known variants and explicitly fall
* through because plugins may add valid unknown cases.
* @module @deepseek-ai/dsh-llm/never
*/
/**
* Mark an unreachable closed-union branch. A newly unhandled typed variant fails at the call site;
* a value that escaped its type throws with diagnostics at runtime.
* @param value - the impossible value; typed `never` so an unhandled variant fails compilation at the call site.
* @param context - optional label (e.g. the switch site) prefixed into the throw message.
* @returns never — it always throws, with the offending value JSON-rendered in the message.
*/
function assertNever(value, context) {
	const rendered = JSON.stringify(value) ?? String(value);
	throw new Error(`unreachable variant${context ? ` in ${context}` : ""}: ${rendered}`);
}
/**
* Incremental chunk-to-message assembler. This is the single canonical assembly
* algorithm used by the agent loop to build an assistant message from a chunk
* stream while logging the raw chunks for replay fidelity.
*
* @module @deepseek-ai/dsh-llm/assembler
*/
/**
* Incrementally assembles raw {@link StreamChunk}s into complete
* {@link ContentBlock}s and a final assistant {@link Message}.
*
* The agent loop feeds it while logging raw chunks for replay fidelity, then
* reads `blocks()` / `message()` / `usage` / `finish` once the stream ends.
*
* Tolerant of delta-only protocols (no block-start/end); deltas arriving for
* an index already closed by `block-end` are ignored (malformed stream) so a
* misbehaving adapter cannot grow memory or corrupt a completed block.
*/
var BlockAssembler = class {
	partials = /* @__PURE__ */ new Map();
	order = [];
	_usage;
	_finish;
	_replayState;
	/**
	* Feed one chunk into the assembly state.
	* @param chunk - the next raw chunk, in stream order.
	*/
	push(chunk) {
		switch (chunk.type) {
			case "block-start":
				if (!this.partials.has(chunk.index)) {
					this.order.push(chunk.index);
					this.partials.set(chunk.index, {
						blockType: chunk.blockType,
						text: "",
						toolCallArguments: ""
					});
				}
				return;
			case "text-delta":
			case "reasoning-delta": {
				const partial = this.ensure(chunk.index, chunk.type === "text-delta" ? "text" : "reasoning");
				if (partial.block) return;
				partial.text += chunk.text;
				return;
			}
			case "tool-call-delta": {
				const partial = this.ensure(chunk.index, "tool-call");
				if (partial.block) return;
				partial.toolCallId = chunk.id;
				if (chunk.name) partial.toolCallName = chunk.name;
				partial.toolCallArguments += chunk.argumentsDelta;
				return;
			}
			case "block-end": {
				const partial = this.ensure(chunk.index, chunk.block.type);
				if (partial.block) return;
				partial.block = chunk.block;
				return;
			}
			case "usage":
				this._usage = chunk.usage;
				return;
			case "finish":
				this._finish = chunk.reason;
				this._replayState = chunk.replayState;
				return;
			default: return assertNever(chunk, "BlockAssembler.push");
		}
	}
	ensure(index, blockType) {
		let partial = this.partials.get(index);
		if (!partial) {
			partial = {
				blockType,
				text: "",
				toolCallArguments: ""
			};
			this.partials.set(index, partial);
			this.order.push(index);
		}
		return partial;
	}
	assemble(partial, index) {
		if (partial.block) return partial.block;
		switch (partial.blockType) {
			case "text": return {
				type: "text",
				text: partial.text
			};
			case "reasoning": return {
				type: "reasoning",
				text: partial.text
			};
			case "tool-call": return {
				type: "tool-call",
				id: partial.toolCallId ?? CallId(`call-${index}`),
				name: partial.toolCallName ?? "",
				arguments: partial.toolCallArguments
			};
			default: throw new Error(`cannot assemble incomplete block of type "${partial.blockType}"`);
		}
	}
	/** Invariant accessor: every index in `order` has a partial. */
	mustGet(index) {
		const partial = this.partials.get(index);
		if (!partial) throw new Error(`BlockAssembler invariant violated: no partial for index ${index}`);
		return partial;
	}
	/**
	* The one shared keep/drop decision over all seen blocks: max-token
	* truncation drops tool calls that cannot be executed safely. Emitted blocks
	* and replay metadata both derive from this result, so they cannot disagree.
	*/
	assembled() {
		const all = this.order.map((index) => this.assemble(this.mustGet(index), index));
		const kept = this.finish.kind === "max-tokens" ? all.map((block) => block.type !== "tool-call") : void 0;
		const blocks = kept === void 0 ? all : all.filter((_, position) => kept[position]);
		const envelope = this._replayState;
		if (envelope?.blocks === void 0) return {
			blocks,
			replay: envelope
		};
		if (envelope.blocks.length !== all.length) return {
			blocks,
			replay: void 0
		};
		return {
			blocks,
			replay: kept === void 0 || blocks.length === all.length ? envelope : {
				response: envelope.response,
				blocks: envelope.blocks.filter((_, position) => kept[position])
			}
		};
	}
	/**
	* Assemble all blocks seen so far, in stream order.
	* @returns one block per seen index, except that max-token truncation drops
	*   tool calls that cannot be executed safely; an open block assembles from
	*   its accumulated deltas (an unknown block type never closed by `block-end` throws).
	*/
	blocks() {
		return this.assembled().blocks;
	}
	/** Usage from the `usage` chunk; undefined until one arrives. */
	get usage() {
		return this._usage;
	}
	/** Finish reason from the `finish` chunk; `{kind: 'stop'}` when the stream ended without one. */
	get finish() {
		return this._finish ?? { kind: "stop" };
	}
	/**
	* Replay metadata from the terminal finish chunk, if any, with per-block
	* entries pruned in step with {@link blocks}. Undefined when the envelope's
	* entries do not align with the emitted blocks.
	*/
	get replayState() {
		return this.assembled().replay;
	}
	/**
	* The assembled assistant message.
	* @param source - producer attribution for the assembled message.
	* @returns a frozen assistant-role message over `blocks()` (same open-block assembly rules).
	*/
	message(source = {
		kind: "plugin",
		plugin: "dsh-llm/assembler"
	}) {
		return createMessage({
			role: "assistant",
			content: this.blocks(),
			source
		});
	}
};
//#endregion
//#region ../../deepseek-harness/packages/core/session/lib/index.js
/** Lossless-JSON validation and detached snapshots for durable session data. @module @deepseek-ai/dsh-session/json */
/** Whether a realm-owned intrinsic prototype is backed by its native constructor. */
function hasIntrinsicConstructor$1(prototype, name) {
	const constructor = Object.getOwnPropertyDescriptor(prototype, "constructor")?.value;
	if (typeof constructor !== "function") return false;
	try {
		return constructor.name === name && constructor.prototype === prototype && Function.prototype.toString.call(constructor) === `function ${name}() { [native code] }`;
	} catch {
		return false;
	}
}
/** Whether a candidate is one realm's intrinsic `Object.prototype`. */
function isIntrinsicObjectPrototype$1(value) {
	return Object.getPrototypeOf(value) === null && hasIntrinsicConstructor$1(value, "Object");
}
/** Whether an array uses one realm's intrinsic `Array.prototype`, not a subclass or forged prototype. */
function hasPlainArrayPrototype$1(value) {
	const prototype = Object.getPrototypeOf(value);
	if (!Array.isArray(prototype) || !hasIntrinsicConstructor$1(prototype, "Array")) return false;
	const objectPrototype = Object.getPrototypeOf(prototype);
	return typeof objectPrototype === "object" && objectPrototype !== null && isIntrinsicObjectPrototype$1(objectPrototype);
}
/** Whether an object is a plain or null-prototype record from any JavaScript realm. */
function hasPlainObjectPrototype(value) {
	const prototype = Object.getPrototypeOf(value);
	return prototype === null || typeof prototype === "object" && isIntrinsicObjectPrototype$1(prototype);
}
/** Return every JSON-visible object key, or reject own data JSON would discard. */
function enumerableStringKeys(value) {
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => typeof key !== "string" || !Object.prototype.propertyIsEnumerable.call(value, key))) return void 0;
	return keys;
}
/** Validate lossless JSON iteratively, optionally materializing a detached snapshot. */
function walkJsonValue(value, detach) {
	const ancestors = /* @__PURE__ */ new Set();
	let root;
	const assign = (destination, item) => {
		if (destination === void 0) return;
		if (destination.kind === "root") root = item;
		else if (destination.kind === "array") destination.target[destination.index] = item;
		else Object.defineProperty(destination.target, destination.key, {
			value: item,
			enumerable: true,
			configurable: true,
			writable: true
		});
	};
	const tasks = [{
		kind: "visit",
		value,
		...detach ? { destination: { kind: "root" } } : {}
	}];
	for (let task = tasks.pop(); task !== void 0; task = tasks.pop()) {
		if (task.kind === "leave") {
			ancestors.delete(task.source);
			continue;
		}
		if (task.kind === "array-item") {
			if (!Object.prototype.hasOwnProperty.call(task.source, task.index)) return void 0;
			tasks.push({
				kind: "visit",
				value: task.source[task.index],
				...task.target === void 0 ? {} : { destination: {
					kind: "array",
					target: task.target,
					index: task.index
				} }
			});
			continue;
		}
		if (task.kind === "object-property") {
			tasks.push({
				kind: "visit",
				value: task.source[task.key],
				...task.target === void 0 ? {} : { destination: {
					kind: "object",
					target: task.target,
					key: task.key
				} }
			});
			continue;
		}
		const current = task.value;
		if (current === null) {
			assign(task.destination, null);
			continue;
		}
		if (typeof current === "boolean" || typeof current === "string") {
			assign(task.destination, current);
			continue;
		}
		if (typeof current === "number") {
			if (!Number.isFinite(current) || Object.is(current, -0)) return void 0;
			assign(task.destination, current);
			continue;
		}
		if (typeof current !== "object") return void 0;
		if (ancestors.has(current)) return void 0;
		if (Array.isArray(current)) {
			if (!hasPlainArrayPrototype$1(current)) return void 0;
			const length = current.length;
			if (Reflect.ownKeys(current).length !== length + 1) return void 0;
			const target = detach ? [] : void 0;
			if (target !== void 0) assign(task.destination, target);
			ancestors.add(current);
			tasks.push({
				kind: "leave",
				source: current
			});
			for (let index = length - 1; index >= 0; index--) tasks.push({
				kind: "array-item",
				source: current,
				index,
				...target === void 0 ? {} : { target }
			});
			continue;
		}
		if (!hasPlainObjectPrototype(current)) return void 0;
		const keys = enumerableStringKeys(current);
		if (keys === void 0) return void 0;
		const target = detach ? {} : void 0;
		if (target !== void 0) assign(task.destination, target);
		ancestors.add(current);
		tasks.push({
			kind: "leave",
			source: current
		});
		for (let index = keys.length - 1; index >= 0; index--) {
			const key = keys[index];
			/* v8 ignore next -- the loop is bounded by the captured key count. */
			if (key === void 0) return void 0;
			tasks.push({
				kind: "object-property",
				source: current,
				key,
				...target === void 0 ? {} : { target }
			});
		}
	}
	return detach ? root : true;
}
/**
* Validate and detach lossless JSON in one read per property, so a stateful
* getter cannot change between validation and copying. Traversal is iterative,
* so valid nesting is bounded by available memory rather than the JavaScript
* call stack. Accepts ordinary arrays, plain or null-prototype objects, and JSON
* scalars; rejects sparse, cyclic, exotic, negative-zero, and non-finite values.
* Getter throws propagate.
*
* @param value - the candidate value to validate and detach.
* @returns the detached snapshot, or `undefined` when the value is not
*   losslessly JSON-serializable.
*/
function snapshotJsonValue(value) {
	return walkJsonValue(value, true);
}
/**
* Test the same lossless JSON boundary as {@link snapshotJsonValue} without
* detaching it. Only own enumerable string properties participate; `toJSON`
* is ignored and getters run, so persistence boundaries use the snapshotter.
* @param value - the candidate event data to test.
* @returns whether `value` survives JSON round-trip losslessly.
*/
function isJsonValue(value) {
	return walkJsonValue(value, false) === true;
}
//#endregion
//#region ../../deepseek-harness/packages/core/tools/lib/index.js
/**
* Enforced JSON Schema subset shared by tool outputs, generated Code Mode
* types, subagents, and workflows. The subset accepts any JSON root, an
* annotation-only schema for unconstrained JSON, one scalar `type`, object
* `properties`/`required`/boolean `additionalProperties`, array `items`,
* type-correct scalar `enum`/`const`, and exact-one `oneOf`.
*
* Unsupported or misplaced keywords reject rather than being accepted without
* enforcement. Consumers that require an object root apply
* {@link assertObjectJsonSchema} before accepting input.
* @module dsh-tools/json-schema
*/
/**
* Thrown when a raw schema falls outside the enforced subset. `violations`
* lists every offending path instead of stopping at the first author error.
*/
var JsonSchemaError = class extends HarnessError {
	/** Individual schema violations in walk order. */
	violations;
	constructor(violations) {
		super(`unsupported JSON schema: ${violations.join("; ")}`, "UNSUPPORTED_SCHEMA");
		this.name = "JsonSchemaError";
		this.violations = violations;
	}
};
const CONSTRAINT_KEYWORDS = new Set([
	"type",
	"oneOf",
	"properties",
	"required",
	"additionalProperties",
	"items",
	"enum",
	"const"
]);
const ANNOTATION_KEYWORDS = new Set([
	"description",
	"title",
	"default",
	"examples"
]);
const SCHEMA_TYPES = [
	"object",
	"array",
	"string",
	"number",
	"integer",
	"boolean",
	"null"
];
/** Whether a realm-owned intrinsic prototype is backed by its native constructor. */
function hasIntrinsicConstructor(prototype, name) {
	const constructor = Object.getOwnPropertyDescriptor(prototype, "constructor")?.value;
	if (typeof constructor !== "function") return false;
	try {
		return constructor.name === name && constructor.prototype === prototype && Function.prototype.toString.call(constructor) === `function ${name}() { [native code] }`;
	} catch {
		return false;
	}
}
/** Whether a candidate is one realm's intrinsic `Object.prototype`. */
function isIntrinsicObjectPrototype(value) {
	return Object.getPrototypeOf(value) === null && hasIntrinsicConstructor(value, "Object");
}
/**
* Test for a realm-agnostic plain JSON record without accepting arrays or
* exotic objects.
* @param value - candidate record from any JavaScript realm.
* @returns Whether the value has a plain-object prototype chain.
*/
function isPlainJsonRecord(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	try {
		const prototype = Object.getPrototypeOf(value);
		return prototype === null || typeof prototype === "object" && isIntrinsicObjectPrototype(prototype);
	} catch {
		return false;
	}
}
/** Whether an array uses one realm's intrinsic `Array.prototype`. */
function hasPlainArrayPrototype(value) {
	const prototype = Object.getPrototypeOf(value);
	if (!Array.isArray(prototype) || !hasIntrinsicConstructor(prototype, "Array")) return false;
	const objectPrototype = Object.getPrototypeOf(prototype);
	return typeof objectPrototype === "object" && objectPrototype !== null && isIntrinsicObjectPrototype(objectPrototype);
}
/** Return whether a record contains only own enumerable string keys. */
function hasOnlyEnumerableStringKeys(value) {
	try {
		return Reflect.ownKeys(value).every((key) => typeof key === "string" && Object.prototype.propertyIsEnumerable.call(value, key));
	} catch {
		return false;
	}
}
/**
* Test for an ordinary schema record whose keys survive JSON projection.
* @param value - candidate record from any JavaScript realm.
* @returns Whether the record has an intrinsic prototype and only own enumerable string keys.
*/
function isJsonSchemaRecord(value) {
	return isPlainJsonRecord(value) && hasOnlyEnumerableStringKeys(value);
}
/**
* Test for a dense ordinary array with no JSON-invisible decorations.
* @param value - candidate array from any JavaScript realm.
* @returns Whether the array is intrinsic, dense, and undecorated.
*/
function isPlainJsonArray(value) {
	if (!Array.isArray(value)) return false;
	try {
		if (!hasPlainArrayPrototype(value) || Reflect.ownKeys(value).length !== value.length + 1) return false;
		for (let index = 0; index < value.length; index++) if (!Object.hasOwn(value, index)) return false;
		return true;
	} catch {
		return false;
	}
}
/** Lossless finite JSON number, excluding negative zero. */
function isJsonNumber(value) {
	return typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0);
}
/** Whether a scalar is valid for one declared schema type. */
function scalarMatches(type, value) {
	switch (type) {
		case "string": return typeof value === "string";
		case "number": return isJsonNumber(value);
		case "integer": return isJsonNumber(value) && Number.isInteger(value);
		case "boolean": return typeof value === "boolean";
		case "null": return value === null;
		/* v8 ignore next -- JsonSchemaScalarType is closed; this retains compile-time exhaustiveness. */
		default: return assertNever(type, "JsonSchemaType");
	}
}
/** Keywords that are invalid beside `oneOf`. */
const ONE_OF_SIBLING_KEYWORDS = [
	"properties",
	"required",
	"additionalProperties",
	"items",
	"enum",
	"const"
];
/** Validate object-only fields after its property schemas have been visited. */
function checkObjectSchemaTail(node, path, properties, violations) {
	const hasRequired = Object.hasOwn(node, "required");
	const required = hasRequired ? node.required : void 0;
	if (hasRequired) if (!isPlainJsonArray(required) || required.some((entry) => typeof entry !== "string")) violations.push(`${path}.required must be an array of strings`);
	else {
		const declared = isJsonSchemaRecord(properties) ? properties : {};
		for (const key of required) if (!Object.hasOwn(declared, key)) violations.push(`${path}.required names "${key}" which is not in properties`);
	}
	if (Object.hasOwn(node, "additionalProperties") && typeof node.additionalProperties !== "boolean") violations.push(`${path}.additionalProperties must be a boolean`);
}
/** Collect every violation for one raw schema tree without using the JavaScript call stack. */
function checkSchemaNode(root, rootPath, violations, seen) {
	const tasks = [{
		kind: "enter",
		node: root,
		path: rootPath
	}];
	for (let task = tasks.pop(); task !== void 0; task = tasks.pop()) {
		if (task.kind === "leave") {
			seen.delete(task.node);
			continue;
		}
		if (task.kind === "one-of-tail") {
			for (const key of ONE_OF_SIBLING_KEYWORDS) if (Object.hasOwn(task.node, key)) violations.push(`${task.path}.${key} is not supported beside oneOf`);
			continue;
		}
		if (task.kind === "object-tail") {
			checkObjectSchemaTail(task.node, task.path, task.properties, violations);
			continue;
		}
		const { node, path } = task;
		if (!isJsonSchemaRecord(node)) {
			violations.push(`${path} must be a schema object`);
			continue;
		}
		if (seen.has(node)) {
			violations.push(`${path} is circular`);
			continue;
		}
		seen.add(node);
		tasks.push({
			kind: "leave",
			node
		});
		for (const key of Object.keys(node)) {
			if (CONSTRAINT_KEYWORDS.has(key)) continue;
			if (ANNOTATION_KEYWORDS.has(key)) {
				try {
					if (!isJsonValue(node[key])) violations.push(`${path}.${key} annotation must be lossless JSON data`);
				} catch {
					violations.push(`${path}.${key} annotation must be lossless JSON data`);
				}
				continue;
			}
			violations.push(`${path}.${key} is not a supported keyword (subset: type/oneOf/properties/required/additionalProperties/items/enum/const + annotations)`);
		}
		if (Object.hasOwn(node, "description") && typeof node.description !== "string") violations.push(`${path}.description must be a string`);
		if (Object.hasOwn(node, "title") && typeof node.title !== "string") violations.push(`${path}.title must be a string`);
		const hasType = Object.hasOwn(node, "type");
		const hasOneOf = Object.hasOwn(node, "oneOf");
		if (hasType && hasOneOf) {
			violations.push(`${path} cannot declare both type and oneOf`);
			continue;
		}
		if (!hasType && !hasOneOf) {
			for (const key of ONE_OF_SIBLING_KEYWORDS) if (Object.hasOwn(node, key)) violations.push(`${path}.${key} requires type or oneOf`);
			continue;
		}
		if (hasOneOf) {
			const oneOf = node.oneOf;
			tasks.push({
				kind: "one-of-tail",
				node,
				path
			});
			if (!isPlainJsonArray(oneOf) || oneOf.length < 2) violations.push(`${path}.oneOf must be an array of at least two schemas`);
			else for (let index = oneOf.length - 1; index >= 0; index--) tasks.push({
				kind: "enter",
				node: oneOf[index],
				path: `${path}.oneOf[${index}]`
			});
			continue;
		}
		const type = node.type;
		if (typeof type !== "string" || !SCHEMA_TYPES.includes(type)) {
			violations.push(Array.isArray(type) ? `${path}.type must be a single type string (type arrays are not supported)` : `${path}.type must be one of ${SCHEMA_TYPES.join("/")}`);
			continue;
		}
		const schemaType = type;
		for (const [key, types] of Object.entries({
			properties: ["object"],
			required: ["object"],
			additionalProperties: ["object"],
			items: ["array"],
			enum: [
				"string",
				"number",
				"integer",
				"boolean",
				"null"
			],
			const: [
				"string",
				"number",
				"integer",
				"boolean",
				"null"
			]
		})) if (Object.hasOwn(node, key) && !types.includes(schemaType)) violations.push(`${path}.${key} is not supported on type "${schemaType}"`);
		switch (schemaType) {
			case "object": {
				const properties = Object.hasOwn(node, "properties") ? node.properties : void 0;
				tasks.push({
					kind: "object-tail",
					node,
					path,
					properties
				});
				if (Object.hasOwn(node, "properties")) if (!isJsonSchemaRecord(properties)) violations.push(`${path}.properties must be an object of schemas`);
				else {
					const entries = Object.entries(properties);
					for (let index = entries.length - 1; index >= 0; index--) {
						const entry = entries[index];
						/* v8 ignore next -- the loop is bounded by the captured entry count. */
						if (entry === void 0) continue;
						tasks.push({
							kind: "enter",
							node: entry[1],
							path: `${path}.properties.${entry[0]}`
						});
					}
				}
				break;
			}
			case "array":
				if (Object.hasOwn(node, "items")) tasks.push({
					kind: "enter",
					node: node.items,
					path: `${path}.items`
				});
				break;
			case "string":
			case "number":
			case "integer":
			case "boolean":
			case "null": {
				const hasEnum = Object.hasOwn(node, "enum");
				const allowed = hasEnum ? node.enum : void 0;
				const enumValid = isPlainJsonArray(allowed) && allowed.length > 0 && allowed.every((entry) => scalarMatches(schemaType, entry));
				if (hasEnum && !enumValid) violations.push(`${path}.enum must be a non-empty array of ${schemaType} values`);
				const hasConst = Object.hasOwn(node, "const");
				const declaredConst = hasConst ? node.const : void 0;
				const constValid = scalarMatches(schemaType, declaredConst);
				if (hasConst) {
					if (!constValid) violations.push(`${path}.const must be a ${schemaType} value`);
					else if (enumValid && !allowed.includes(declaredConst)) violations.push(`${path}.const must be one of ${path}.enum when both are declared`);
				}
				break;
			}
			/* v8 ignore next -- schemaType was narrowed from the closed SCHEMA_TYPES table above. */
			default: assertNever(schemaType, "JsonSchemaType");
		}
	}
}
/**
* Assert that an arbitrary raw schema uses only the enforced subset.
* Annotation-only schemas are accepted as the standard unconstrained-JSON
* form; callers that require an object root use {@link assertObjectJsonSchema}.
* @param schema - untrusted raw JSON Schema.
* @returns Assertion that the schema belongs to the supported subset.
*/
function assertSupportedJsonSchema(schema) {
	const violations = [];
	checkSchemaNode(schema, "schema", violations, /* @__PURE__ */ new Set());
	if (violations.length > 0) throw new JsonSchemaError(violations);
}
/** Safely test the lossless JSON boundary when a getter may throw. */
function safelyIsJsonValue(value) {
	try {
		return isJsonValue(value);
	} catch {
		return false;
	}
}
/** Root-aware diagnostic path for the parameter validator's empty sentinel. */
function diagnosticPath(path) {
	return path === "" ? "arguments" : path;
}
/** Append one object property without a leading dot at an implicit root. */
function propertyPath(path, key) {
	return path === "" ? key : `${path}.${key}`;
}
/** The generic exception-containment diagnostic owned by one valid schema node. */
function losslessValueViolation(path) {
	return [`"${diagnosticPath(path)}" must be a lossless JSON value`];
}
/** Append diagnostics without spreading a potentially wide child result as call arguments. */
function appendViolations(target, source) {
	for (const violation of source) target.push(violation);
}
/** Initialize one validation frame with empty aggregation state. */
function valueFrame(node, value, path) {
	return {
		node,
		value,
		path,
		catches: false,
		phase: "start",
		children: [],
		childIndex: 0,
		violations: [],
		tailViolations: [],
		matches: 0
	};
}
/** Validate one scalar node after its primitive type check. */
function checkScalarValue(node, value, path) {
	const allowed = Object.hasOwn(node, "enum") ? node.enum : void 0;
	if (allowed !== void 0 && !allowed.includes(value)) return [`"${diagnosticPath(path)}" must be one of ${JSON.stringify(allowed)}`];
	if (Object.hasOwn(node, "const") && value !== node.const) return [`"${diagnosticPath(path)}" must be ${JSON.stringify(node.const)}`];
	return [];
}
/** Validate one trusted schema/value pair with explicit frames rather than recursive calls. */
function checkValue(schema, value, path) {
	const frames = [valueFrame(schema, value, path)];
	let rootResult;
	const receive = (result) => {
		const parent = frames.at(-1);
		if (parent === void 0) {
			rootResult = result;
			return;
		}
		if (parent.kind === "oneOf") {
			if (result.length === 0) parent.matches++;
		} else appendViolations(parent.violations, result);
	};
	const finish = (result) => {
		frames.pop();
		receive(result);
	};
	while (frames.length > 0) {
		const frame = frames.at(-1);
		/* v8 ignore next -- the loop condition guarantees a current frame. */
		if (frame === void 0) break;
		try {
			if (frame.phase === "children") {
				if (frame.childIndex < frame.children.length) {
					const child = frame.children[frame.childIndex];
					/* v8 ignore next -- childIndex is bounded by children.length. */
					if (child === void 0) throw new Error("missing schema-value child frame");
					frame.childIndex++;
					frames.push(valueFrame(child.node, child.value, child.path));
					continue;
				}
				if (frame.kind === "oneOf") {
					finish(frame.matches === 1 ? [] : [`"${diagnosticPath(frame.path)}" must match exactly one oneOf branch (matched ${frame.matches})`]);
					continue;
				}
				appendViolations(frame.violations, frame.tailViolations);
				if (frame.violations.length > 0) finish(frame.violations);
				else if (frame.kind === "object") finish(safelyIsJsonValue(frame.value) ? [] : [`"${diagnosticPath(frame.path)}" must be a lossless JSON object`]);
				else finish(safelyIsJsonValue(frame.value) ? [] : [`"${diagnosticPath(frame.path)}" must be a dense lossless JSON array`]);
				continue;
			}
			const nodeType = Object.hasOwn(frame.node, "type") ? frame.node.type : void 0;
			frame.catches = !(nodeType !== void 0 && !SCHEMA_TYPES.includes(nodeType));
			const oneOf = Object.hasOwn(frame.node, "oneOf") ? frame.node.oneOf : void 0;
			if (oneOf !== void 0) {
				frame.kind = "oneOf";
				frame.children = Array.from(oneOf, (branch) => ({
					node: branch,
					value: frame.value,
					path: frame.path
				}));
				frame.childIndex = 0;
				frame.matches = 0;
				frame.phase = "children";
				continue;
			}
			if (nodeType === void 0) {
				finish(safelyIsJsonValue(frame.value) ? [] : losslessValueViolation(frame.path));
				continue;
			}
			switch (nodeType) {
				case "object": {
					if (!isPlainJsonRecord(frame.value)) {
						finish([`"${diagnosticPath(frame.path)}" must be an object`]);
						break;
					}
					const properties = Object.hasOwn(frame.node, "properties") ? frame.node.properties ?? {} : {};
					const violations = [];
					const required = Object.hasOwn(frame.node, "required") ? frame.node.required ?? [] : [];
					for (const key of required) if (!Object.hasOwn(frame.value, key) || frame.value[key] === void 0) violations.push(`missing required property "${propertyPath(frame.path, key)}"`);
					const children = [];
					for (const [key, child] of Object.entries(properties)) {
						if (!Object.hasOwn(frame.value, key) || frame.value[key] === void 0) continue;
						children.push({
							node: child,
							value: frame.value[key],
							path: propertyPath(frame.path, key)
						});
					}
					const tailViolations = [];
					if (Object.hasOwn(frame.node, "additionalProperties") && frame.node.additionalProperties === false) {
						for (const key of Object.keys(frame.value)) if (!Object.hasOwn(properties, key)) tailViolations.push(`"${propertyPath(frame.path, key)}" is not a declared property (additionalProperties: false)`);
					}
					frame.kind = "object";
					frame.children = children;
					frame.childIndex = 0;
					frame.violations = violations;
					frame.tailViolations = tailViolations;
					frame.phase = "children";
					break;
				}
				case "array": {
					if (!Array.isArray(frame.value)) {
						finish([`"${diagnosticPath(frame.path)}" must be an array`]);
						break;
					}
					const items = Object.hasOwn(frame.node, "items") ? frame.node.items : void 0;
					const children = items === void 0 ? [] : frame.value.flatMap((entry, index) => [{
						node: items,
						value: entry,
						path: `${frame.path}[${index}]`
					}]);
					frame.kind = "array";
					frame.children = children;
					frame.childIndex = 0;
					frame.violations = [];
					frame.phase = "children";
					break;
				}
				case "string":
					finish(typeof frame.value === "string" ? checkScalarValue(frame.node, frame.value, frame.path) : [`"${diagnosticPath(frame.path)}" must be a string`]);
					break;
				case "number":
					finish(typeof frame.value !== "number" ? [`"${diagnosticPath(frame.path)}" must be a number`] : !isJsonNumber(frame.value) ? [`"${diagnosticPath(frame.path)}" must be a finite JSON number`] : checkScalarValue(frame.node, frame.value, frame.path));
					break;
				case "integer":
					finish(!isJsonNumber(frame.value) || !Number.isInteger(frame.value) ? [`"${diagnosticPath(frame.path)}" must be an integer`] : checkScalarValue(frame.node, frame.value, frame.path));
					break;
				case "boolean":
					finish(typeof frame.value === "boolean" ? checkScalarValue(frame.node, frame.value, frame.path) : [`"${diagnosticPath(frame.path)}" must be a boolean`]);
					break;
				case "null":
					finish(frame.value === null ? checkScalarValue(frame.node, frame.value, frame.path) : [`"${diagnosticPath(frame.path)}" must be null`]);
					break;
				default: finish(assertNever(nodeType, "JsonSchemaType"));
			}
		} catch (error) {
			let failed = frames.pop();
			while (failed !== void 0 && !failed.catches) failed = frames.pop();
			if (failed === void 0) throw error;
			receive(losslessValueViolation(failed.path));
		}
	}
	/* v8 ignore next -- every root frame finishes or throws. */
	return rootResult ?? losslessValueViolation(path);
}
/**
* Validate a candidate value against an asserted raw schema. The function is
* total for arbitrary values and returns path-qualified violations.
* @param schema - a schema accepted by {@link assertSupportedJsonSchema}.
* @param value - the candidate JSON value.
* @param path - root label used in diagnostics.
* @returns All violations in walk order; empty means valid.
*/
function validateJsonSchemaValue(schema, value, path = "value") {
	return checkValue(schema, value, path);
}
/** Unified JSON-value schema DSL, inference, compilation, and typed tool helper. @module dsh-tools/schema */
const ANNOTATION_KEYS = [
	"description",
	"title",
	"default",
	"examples"
];
/** Throw one author-schema violation through the shared schema error type. */
function authorError(message) {
	throw new JsonSchemaError([message]);
}
/** Copy own annotation fields for validation by the raw-schema boundary. */
function copyAnnotations(source, target) {
	if (Object.hasOwn(source, "description")) target.description = source.description;
	if (Object.hasOwn(source, "title")) target.title = source.title;
	if (Object.hasOwn(source, "default")) target.default = source.default;
	if (Object.hasOwn(source, "examples")) target.examples = source.examples;
}
/** Reject author-only keys outside one node's declared vocabulary. */
function assertAuthorKeys(source, path, allowed) {
	for (const key of Object.keys(source)) if (!allowed.includes(key)) authorError(`${path}.${key} is not supported by the value schema DSL`);
}
/** Install a compiled node without giving `__proto__` assignment semantics. */
function assignCompiledNode(destination, node) {
	switch (destination.kind) {
		case "root":
			destination.holder.value = node;
			break;
		case "property":
			Object.defineProperty(destination.target, destination.key, {
				value: node,
				enumerable: true,
				configurable: true,
				writable: true
			});
			break;
		case "item":
			destination.target.items = node;
			break;
		case "one-of":
			destination.target[destination.index] = node;
			break;
	}
}
/** Install a compiled property map at its root or containing object node. */
function assignCompiledPropertyMap(destination, compiled) {
	if (destination.kind === "root") destination.holder.value = compiled;
	else destination.target.properties = compiled.properties;
}
/** Execute an author-schema compilation task graph without recursive descent. */
function runSchemaCompiler(initial) {
	const seen = /* @__PURE__ */ new Set();
	const tasks = [initial];
	for (let task = tasks.pop(); task !== void 0; task = tasks.pop()) {
		if (task.kind === "leave") {
			seen.delete(task.input);
			continue;
		}
		if (task.kind === "property-map-tail") {
			if (task.required.length > 0) {
				task.compiled.required = task.required;
				if (task.destination.kind === "object") task.destination.target.required = task.required;
			}
			continue;
		}
		if (task.kind === "property") {
			if (!isJsonSchemaRecord(task.property)) authorError(`${task.path} must be a value schema object`);
			if (Object.hasOwn(task.property, "required") && task.property.required !== true) authorError(`${task.path}.required must be true when present`);
			if (Object.hasOwn(task.property, "required") && task.property.required === true) task.required.push(task.key);
			tasks.push({
				kind: "value",
				input: task.property,
				path: task.path,
				allowRequired: true,
				destination: {
					kind: "property",
					target: task.properties,
					key: task.key
				}
			});
			continue;
		}
		if (task.kind === "property-map") {
			if (!isJsonSchemaRecord(task.input)) authorError(`${task.path} must be an object of value schemas`);
			if (seen.has(task.input)) authorError(`${task.path} is circular`);
			seen.add(task.input);
			const compiled = { properties: {} };
			const required = [];
			assignCompiledPropertyMap(task.destination, compiled);
			tasks.push({
				kind: "leave",
				input: task.input
			});
			tasks.push({
				kind: "property-map-tail",
				compiled,
				required,
				destination: task.destination
			});
			const entries = Object.entries(task.input);
			for (let index = entries.length - 1; index >= 0; index--) {
				const entry = entries[index];
				/* v8 ignore next -- the loop is bounded by the captured entry count. */
				if (entry === void 0) continue;
				tasks.push({
					kind: "property",
					property: entry[1],
					path: `${task.path}.${entry[0]}`,
					key: entry[0],
					properties: compiled.properties,
					required
				});
			}
			continue;
		}
		const { input, path } = task;
		if (!isJsonSchemaRecord(input)) authorError(`${path} must be a value schema object`);
		if (seen.has(input)) authorError(`${path} is circular`);
		seen.add(input);
		const authorKeys = [...ANNOTATION_KEYS, ...task.allowRequired ? ["required"] : []];
		const node = {};
		assignCompiledNode(task.destination, node);
		tasks.push({
			kind: "leave",
			input
		});
		if (Object.hasOwn(input, "oneOf")) {
			assertAuthorKeys(input, path, [
				...authorKeys,
				"oneOf",
				"type"
			]);
			if (Object.hasOwn(input, "type")) authorError(`${path} cannot declare both type and oneOf`);
			if (!isPlainJsonArray(input.oneOf)) authorError(`${path}.oneOf must be an array of at least two value schemas`);
			const branches = [];
			node.oneOf = branches;
			copyAnnotations(input, node);
			for (let index = input.oneOf.length - 1; index >= 0; index--) tasks.push({
				kind: "value",
				input: input.oneOf[index],
				path: `${path}.oneOf[${index}]`,
				allowRequired: false,
				destination: {
					kind: "one-of",
					target: branches,
					index
				}
			});
			continue;
		}
		const inputType = Object.hasOwn(input, "type") ? input.type : void 0;
		switch (inputType) {
			case "json":
				assertAuthorKeys(input, path, [...authorKeys, "type"]);
				copyAnnotations(input, node);
				break;
			case "object":
				assertAuthorKeys(input, path, [
					...authorKeys,
					"type",
					"properties",
					"additionalProperties"
				]);
				if (!Object.hasOwn(input, "additionalProperties") || typeof input.additionalProperties !== "boolean") authorError(`${path}.additionalProperties must be explicitly true or false`);
				node.type = "object";
				copyAnnotations(input, node);
				node.additionalProperties = input.additionalProperties;
				if (Object.hasOwn(input, "properties")) tasks.push({
					kind: "property-map",
					input: input.properties,
					path: `${path}.properties`,
					destination: {
						kind: "object",
						target: node
					}
				});
				break;
			case "array":
				assertAuthorKeys(input, path, [
					...authorKeys,
					"type",
					"items"
				]);
				node.type = "array";
				copyAnnotations(input, node);
				if (Object.hasOwn(input, "items")) tasks.push({
					kind: "value",
					input: input.items,
					path: `${path}.items`,
					allowRequired: false,
					destination: {
						kind: "item",
						target: node
					}
				});
				break;
			case "string":
			case "number":
			case "integer":
			case "boolean":
			case "null":
				assertAuthorKeys(input, path, [
					...authorKeys,
					"type",
					"enum",
					"const"
				]);
				node.type = inputType;
				copyAnnotations(input, node);
				if (Object.hasOwn(input, "enum")) {
					if (!isPlainJsonArray(input.enum)) authorError(`${path}.enum must be a non-empty array of scalar values`);
					node.enum = Array.from(input.enum, (entry) => entry);
				}
				if (Object.hasOwn(input, "const")) node.const = input.const;
				break;
			default: authorError(`${path}.type must be string/number/integer/boolean/null/array/object/json, or use oneOf`);
		}
	}
}
/** Compile one implicit property map, collecting per-property requiredness. */
function compilePropertyMap(input, path) {
	const holder = {};
	runSchemaCompiler({
		kind: "property-map",
		input,
		path,
		destination: {
			kind: "root",
			holder
		}
	});
	/* v8 ignore next -- the root task assigns before scheduling any descendants. */
	return holder.value ?? authorError(`${path} did not compile`);
}
/** Compile one author node without applying any consumer root restriction. */
function compileValueSchema(input, path) {
	const holder = {};
	runSchemaCompiler({
		kind: "value",
		input,
		path,
		allowRequired: false,
		destination: {
			kind: "root",
			holder
		}
	});
	/* v8 ignore next -- the root task assigns before scheduling any descendants. */
	return holder.value ?? authorError(`${path} did not compile`);
}
/**
* Compile one author-facing value schema to the enforced raw JSON Schema
* subset. The author-only `json` node becomes an annotation-only schema.
* @param spec - schema for any JSON-value root.
* @returns The asserted raw schema projection.
*/
function valueSchemaSpecToJsonSchema(spec) {
	const schema = compileValueSchema(spec, "schema");
	assertSupportedJsonSchema(schema);
	return schema;
}
/**
* Compile the implicit open parameter object into raw JSON Schema.
* @param spec - per-property parameter definitions.
* @returns An object-rooted raw schema with no implicit-root openness override.
*/
function parameterSchemaSpecToJsonSchema(spec) {
	const compiled = compilePropertyMap(spec, "parameters");
	const schema = {
		type: "object",
		properties: compiled.properties,
		...compiled.required === void 0 ? {} : { required: compiled.required }
	};
	assertSupportedJsonSchema(schema);
	return schema;
}
/** Invalid model-generated arguments for a typed tool. */
var ToolArgsError = class extends HarnessError {
	/** Individual violations in schema-walk order. */
	violations;
	constructor(violations) {
		super(`invalid arguments: ${violations.join("; ")}`, "INVALID_ARGS");
		this.name = "ToolArgsError";
		this.violations = violations;
	}
};
/**
* Define a first-party tool with inferred arguments and strict execution
* validation. Replay-only presenters validate softly and fall back to generic
* rendering for obsolete logged arguments.
* @param options - typed definition and optional finalizer and presenters.
* @returns A registry-ready definition.
*/
function defineTool(options) {
	const userExecute = options.execute;
	const userFinalizeContent = options.finalizeContent;
	const userRender = options.output.render;
	const userPresentationMeta = options.output.presentationMeta;
	const userPresentCall = options.presentCall;
	const userPresentResult = options.presentResult;
	const userIsConcurrencySafe = options.isConcurrencySafe;
	if (options.timeoutMs !== void 0 && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) throw new Error(`defineTool(${options.name}): timeoutMs must be a positive finite number`);
	const parameters = parameterSchemaSpecToJsonSchema(options.parameters);
	const outputSchema = valueSchemaSpecToJsonSchema(options.output.schema);
	const validate = (args) => validateJsonSchemaValue(parameters, args, "");
	const tool = {
		name: options.name,
		description: options.description,
		parameters,
		output: {
			schema: outputSchema,
			render(args, value) {
				return userRender(args, value);
			},
			...userPresentationMeta !== void 0 ? { presentationMeta(args, value) {
				return userPresentationMeta(args, value);
			} } : {}
		},
		...options.timeoutMs !== void 0 ? { timeoutMs: options.timeoutMs } : {},
		async execute(args, exec) {
			const violations = validate(args);
			if (violations.length > 0) throw new ToolArgsError(violations);
			return userExecute(args, exec);
		}
	};
	if (userFinalizeContent) tool.finalizeContent = (exec, result) => userFinalizeContent(exec, result);
	if (userPresentCall) tool.presentCall = (args) => {
		if (validate(args).length > 0) return void 0;
		return userPresentCall(args);
	};
	if (userPresentResult) tool.presentResult = (args, result) => {
		if (validate(args).length > 0) return void 0;
		return userPresentResult(args, result);
	};
	if (userIsConcurrencySafe) tool.isConcurrencySafe = (args) => {
		if (validate(args).length > 0) return false;
		return userIsConcurrencySafe(args);
	};
	return tool;
}
/**
* Code Mode `run_code` transport. Programs call the registry's agent-visible
* tools through nested executions scheduled under the native concurrency
* contract; each sub-dispatch is logged for reconstruction, while only the
* outer curated result enters model history.
* @module @deepseek-ai/dsh-tools/src/code-mode
*/
/** The model-facing name of the Code Mode tool. */
const RUN_CODE_NAME = "run_code";
/**
* The TypeScript flavor: the fallback for a schema read with no runtime
* mounted ({@link resolveFlavor} owns which readers reach that). A real
* assembly always resolves a runtime first, so the model never sees this
* fallback outside its own language.
*/
const TYPESCRIPT_FLAVOR = {
	description: "Execute a TypeScript program against the available tools. Takes two required arguments: `code`, the BODY of an async function (erasable syntax only; top-level `await` and `return` work), and `description`, a short summary of what the program does. Call tools as `await tools.name(args)` per the declarations in the system prompt. Only what you print or return is program output — curate it. Image-bearing subtool results are attached after the run.",
	codeDescription: "The program: the body of an async TypeScript function."
};
/** Per-language `run_code` schema flavors (see {@link RunCodeFlavor}); one entry per {@link CodeSdkLanguage}. */
const RUN_CODE_FLAVORS = {
	typescript: TYPESCRIPT_FLAVOR,
	python: {
		description: "Execute a Python program against the available tools. Takes two required arguments: `code`, the BODY of an async function (top-level `await` and `return` work), and `description`, a short summary of what the program does. Call tools as `await tools.name(args)` per the declarations in the system prompt. Use `print(...)` and/or `return <value>` for program output — curate it. Image-bearing subtool results are attached after the run.",
		codeDescription: "The program: the body of an async Python function."
	}
};
/**
* The `description` parameter's model-facing description: language-independent
* (the UI label contract is the same for every runtime), shared between the
* static spec and the language-aware `parameters` getter so the two emissions
* can never drift.
*/
const RUN_CODE_DESCRIPTION_PARAM_DESCRIPTION = "Clear, concise description of what this program does in active voice, 5-10 words (shown in the UI). Examples: \"Count TODO markers across packages\"; \"Read failing test and its fixture\"; \"Rename config key in every cordis.yml\".";
/**
* Resolve the {@link RunCodeFlavor} for the loaded runtime's language, read at
* schema-emission time so the model-visible `run_code` schema always matches
* the SDK section's language. `peekRuntime` returns `undefined` only when no
* runtime is mounted, which reaches this function through definition readers
* and `schemas()` — the doc-catalog harvest is the only shipped one, and none
* of them feeds a model, because `wireSchemas` calls `requireCodeRuntime`
* before projecting — so that path degrades to {@link TYPESCRIPT_FLAVOR}. A
* mounted runtime whose language has no flavor entry fails loud, exactly as
* `requireCodeRuntime` rejects it at assembly. Keeping this table in step with
* `SDK_RENDERERS` is the compiler's job ({@link CodeSdkLanguage}); what this
* guard owns is the runtime-supplied language neither table knows, which never
* yields a wrong-language schema for a real runtime.
*/
function resolveFlavor(peekRuntime) {
	const runtime = peekRuntime();
	if (runtime === void 0) return TYPESCRIPT_FLAVOR;
	const flavor = RUN_CODE_FLAVORS[runtime.language];
	if (!Object.hasOwn(RUN_CODE_FLAVORS, runtime.language) || flavor === void 0) {
		const known = Object.keys(RUN_CODE_FLAVORS).map((name) => JSON.stringify(name)).join(", ");
		throw new Error(`dsh-tools: no run_code schema flavor registered for runtime language ${JSON.stringify(runtime.language)} (known: ${known})`);
	}
	return flavor;
}
/**
* Thrown by `run_code` when the program run itself failed — a program
* exception, a budget expiry, an abort, or substrate death. Extends
* {@link HarnessError} (`code: 'CODE_RUN_FAILED'`); the registry's execution
* pipeline converts it into a structured `isError` result whose text carries
* the failure kind plus the captured logs, so the model can self-correct.
*/
var CodeRunFailedError = class extends HarnessError {
	constructor(message) {
		super(message, "CODE_RUN_FAILED");
		this.name = "CodeRunFailedError";
	}
};
/**
* Snapshot one binding call's argument as lossless JSON, then snapshot that
* detached value again so dispatch and logging stay independent without
* reintroducing structured-clone's platform-specific nesting limit.
*/
function jsonNormalizeArgs(value) {
	let snapshot;
	try {
		snapshot = snapshotJsonValue(value);
	} catch (error) {
		throw new Error(`tool arguments must be lossless JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (snapshot === void 0) throw new Error("tool arguments must be lossless JSON (call the tool with an arguments object, e.g. `{}`)");
	const logged = snapshotJsonValue(snapshot);
	/* v8 ignore next -- snapshot is already a detached lossless JSON value. */
	if (logged === void 0) throw new Error("tool arguments could not be detached for durable logging");
	return {
		dispatched: snapshot,
		logged
	};
}
/** Two-space JSON presentation, matching the existing shallow `run_code` text contract. */
const JSON_INDENT = "  ";
/**
* ECMAScript caps `JSON.stringify`'s `space` string at ten characters. The
* renderer also caps TOTAL indentation there, compacting deeper subtrees, so
* formatted output remains linear in the canonical JSON size.
*/
const MAX_JSON_INDENT_CHARS = 10;
/** Render one non-string JSON root without recursive traversal or unbounded indentation growth. */
function renderJsonValue(value) {
	const chunks = [];
	const tasks = [{
		kind: "value",
		value,
		depth: 0,
		compact: false
	}];
	for (let task = tasks.pop(); task !== void 0; task = tasks.pop()) {
		if (task.kind === "text") {
			chunks.push(task.text);
			continue;
		}
		const current = task.value;
		if (current === null || typeof current === "boolean" || typeof current === "number") {
			chunks.push(String(current));
			continue;
		}
		if (typeof current === "string") {
			chunks.push(JSON.stringify(current));
			continue;
		}
		const compact = task.compact || (task.depth + 1) * 2 > MAX_JSON_INDENT_CHARS;
		const childDepth = task.depth + 1;
		if (Array.isArray(current)) {
			chunks.push("[");
			if (current.length === 0) {
				chunks.push("]");
				continue;
			}
			tasks.push({
				kind: "text",
				text: compact ? "]" : `\n${JSON_INDENT.repeat(task.depth)}]`
			});
			for (let index = current.length - 1; index >= 0; index--) {
				const item = current[index];
				/* v8 ignore next -- canonical JsonValue arrays are dense. */
				if (item === void 0) throw new Error("cannot render a sparse JSON array");
				tasks.push({
					kind: "value",
					value: item,
					depth: childDepth,
					compact
				});
				tasks.push({
					kind: "text",
					text: compact ? index === 0 ? "" : "," : `${index === 0 ? "\n" : ",\n"}${JSON_INDENT.repeat(childDepth)}`
				});
			}
			continue;
		}
		const keys = Object.keys(current);
		chunks.push("{");
		if (keys.length === 0) {
			chunks.push("}");
			continue;
		}
		tasks.push({
			kind: "text",
			text: compact ? "}" : `\n${JSON_INDENT.repeat(task.depth)}}`
		});
		for (let index = keys.length - 1; index >= 0; index--) {
			const key = keys[index];
			/* v8 ignore next -- the loop is bounded by the captured key count. */
			if (key === void 0) throw new Error("cannot render a missing JSON object key");
			const item = current[key];
			/* v8 ignore next -- canonical JsonValue records contain no undefined properties. */
			if (item === void 0) throw new Error("cannot render an undefined JSON object property");
			tasks.push({
				kind: "value",
				value: item,
				depth: childDepth,
				compact
			});
			tasks.push({
				kind: "text",
				text: compact ? `${index === 0 ? "" : ","}${JSON.stringify(key)}:` : `${index === 0 ? "\n" : ",\n"}${JSON_INDENT.repeat(childDepth)}${JSON.stringify(key)}: `
			});
		}
	}
	return chunks.join("");
}
/** Render one present program completion value for the model-facing result text. */
function renderValue(value) {
	return typeof value === "string" ? value : renderJsonValue(value);
}
/**
* Build the `run_code` {@link ToolDefinition}: required `code` and
* `description` parameters, executed through the dispatch bridge described
* above. The
* registry reserves it as presentation infrastructure under non-native modes,
* outside the filterable global/scoped capability layers.
* @param registry - the owning registry (sub-calls go through its `execute`,
*   bindings cover its registered tools).
* @param options - the registry-private capabilities described above.
* @returns the registry-ready definition.
*/
function createRunCodeTool(registry, options) {
	const { requireRuntime, peekRuntime, maxParallel, shapeDispatchLog } = options;
	const definition = defineTool({
		name: RUN_CODE_NAME,
		description: TYPESCRIPT_FLAVOR.description,
		parameters: {
			code: {
				type: "string",
				required: true,
				description: TYPESCRIPT_FLAVOR.codeDescription
			},
			description: {
				type: "string",
				required: true,
				description: RUN_CODE_DESCRIPTION_PARAM_DESCRIPTION
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					logs: {
						type: "array",
						required: true,
						items: { type: "string" }
					},
					result: { type: "json" }
				}
			},
			render: (_args, value) => {
				const rendered = value.result === void 0 ? "" : renderValue(value.result);
				const parts = [value.logs.join("\n"), rendered].filter((part) => part.length > 0);
				return [{
					type: "text",
					text: parts.length > 0 ? parts.join("\n") : "(run_code completed with no output)"
				}];
			}
		},
		async execute(args, exec) {
			if (args.description.trim().length === 0) throw new Error("invalid description: expected a non-empty string");
			const runtime = requireRuntime();
			const runController = new AbortController();
			const onOuterAbort = () => {
				runController.abort(exec.signal.reason);
			};
			exec.signal.addEventListener("abort", onOuterAbort, { once: true });
			let dispatches = 0;
			const pendingQueue = [];
			const inFlight = /* @__PURE__ */ new Set();
			/** Tracked settle-event side work (log-content listener + append), drained at run settlement. */
			const logWork = /* @__PURE__ */ new Set();
			const commitQueue = [];
			let exclusiveActive = false;
			let driving = false;
			let driverRun = Promise.resolve();
			let wake;
			const wakeup = () => {
				const release = wake;
				wake = void 0;
				release?.();
			};
			/**
			* The single ordered lane. Each pass commits the head-of-line settled
			* dispatch (ordered post-execute), then starts the next queued entry if
			* its slot is free (ordered pre-execute), and otherwise sleeps until a
			* body settles or a new submission arrives. One run reaching the
			* empty-queues/empty-pool state is quiescence.
			*/
			const drive = () => {
				if (driving) return driverRun;
				driving = true;
				driverRun = (async () => {
					try {
						for (;;) {
							const signal = new Promise((resolve) => {
								wake = resolve;
							});
							const commitHead = commitQueue[0];
							if (commitHead !== void 0 && commitHead.settled) {
								commitQueue.shift();
								await commitHead.commit();
								if (commitHead.mode === "exclusive") exclusiveActive = false;
								continue;
							}
							const head = pendingQueue[0];
							if (head !== void 0) {
								if (runController.signal.aborted) {
									pendingQueue.shift();
									head.abandon();
									continue;
								}
								const mode = head.classify();
								if (!exclusiveActive && (mode === "exclusive" ? inFlight.size === 0 : inFlight.size < maxParallel)) {
									if (mode === "exclusive") exclusiveActive = true;
									head.mode = mode;
									pendingQueue.shift();
									commitQueue.push(head);
									await head.start();
									const flight = head.flight.finally(() => {
										inFlight.delete(flight);
										wakeup();
									});
									inFlight.add(flight);
									continue;
								}
							}
							if (pendingQueue.length === 0 && commitQueue.length === 0 && inFlight.size === 0) return;
							await signal;
						}
					} finally {
						driving = false;
						wake = void 0;
					}
				})();
				return driverRun;
			};
			/** Every dispatch settled AND committed; nothing can start (the run is aborted at call time). */
			const drainDispatches = async () => {
				await drive();
				while (logWork.size > 0) await Promise.allSettled([...logWork]);
			};
			const runOver = () => runController.signal.aborted;
			const binding = (name) => async (rawArgs) => {
				if (runOver()) throw new Error(`run_code run is over (${String(runController.signal.reason)}); ${name} not dispatched`);
				const normalized = jsonNormalizeArgs(rawArgs);
				const n = ++dispatches;
				const subCallId = CallId(`${String(exec.callId)}:code:${n}`);
				const input = {
					callId: subCallId,
					rootCallId: exec.rootCallId,
					name,
					arguments: normalized.dispatched,
					...exec.agent ? { agent: exec.agent } : {},
					parent: exec.token,
					signal: runController.signal
				};
				const scheduler = registry[TOOL_RUNTIME_SCHEDULER];
				const outcome = await new Promise((resolve, reject) => {
					let parked;
					const settle = (result) => {
						resolve(result.isError ? {
							isError: true,
							message: result.error.message
						} : {
							isError: false,
							value: result.value
						});
						const agent = exec.agent;
						if (agent === void 0) return;
						const task = (async () => {
							const logged = await shapeDispatchLog({
								exec,
								agent,
								subCallId,
								name,
								isError: result.isError,
								content: result.content
							});
							agent.session.append("tool/code-dispatch", {
								rootCallId: exec.rootCallId,
								parentCallId: exec.callId,
								subCallId,
								name,
								arguments: normalized.logged,
								isError: result.isError,
								content: logged
							});
						})().finally(() => {
							logWork.delete(task);
						});
						logWork.add(task);
					};
					pendingQueue.push({
						flight: Promise.resolve(),
						settled: false,
						classify: () => registry.executionMode(input).kind,
						abandon: () => {
							reject(/* @__PURE__ */ new Error(`run_code run is over (${String(runController.signal.reason)}); ${name} tool call abandoned`));
						},
						async start() {
							exec.agent?.session.append("tool/code-dispatch-start", {
								rootCallId: exec.rootCallId,
								parentCallId: exec.callId,
								subCallId,
								name,
								arguments: normalized.logged
							});
							const prepared = await scheduler.prepare(input);
							if (prepared.kind === "dispatch") {
								this.flight = scheduler.dispatch(prepared.exec).then((dispatchOutcome) => {
									parked = {
										kind: dispatchOutcome.kind,
										exec: prepared.exec,
										result: dispatchOutcome.result
									};
									this.settled = true;
								});
								return;
							}
							parked = {
								kind: prepared.kind,
								exec: prepared.exec,
								result: prepared.result
							};
							this.settled = true;
						},
						async commit() {
							/* v8 ignore next -- commit() runs only after `settled` flipped, which set parked. */
							if (parked === void 0) return;
							const result = parked.kind === "post-result" ? await scheduler.finalize(parked.exec, parked.result) : scheduler.finish(parked.exec, parked.result);
							if (!result.isError && result.content.some((block) => block.type === "image")) exec.deferContext(createUserMessage({
								content: result.content,
								source: {
									kind: "plugin",
									plugin: "tools-code-mode"
								}
							}));
							for (const context of result.additionalContexts ?? []) exec.deferContext(context);
							if (result.concludesTurn) exec.concludeTurn();
							settle(result);
							while (logWork.size > maxParallel) await Promise.race(logWork);
						}
					});
					wakeup();
					drive();
				});
				if (runOver()) throw new Error(`run_code run is over (${String(runController.signal.reason)}); ${name} result discarded`);
				if (outcome.isError) throw new Error(outcome.message);
				return outcome.value;
			};
			const functions = Object.create(null);
			for (const schema of registry.schemas(exec.agent)) {
				if (schema.name === "run_code") continue;
				Object.defineProperty(functions, schema.name, {
					enumerable: true,
					value: binding(schema.name)
				});
			}
			try {
				let result;
				try {
					result = await runtime.run({
						program: args.code,
						bindings: [{
							global: "tools",
							functions,
							errorClass: {
								name: "ToolCallError",
								memberNameProperty: "toolName"
							}
						}],
						signal: runController.signal
					});
				} finally {
					runController.abort("run_code settled");
					await drainDispatches();
				}
				if (result.error) {
					const logsText = result.logs.length > 0 ? `\nCaptured output:\n${result.logs.join("\n")}` : "";
					throw new CodeRunFailedError(`code run failed (${result.error.kind}): ${result.error.message}${logsText}`);
				}
				return {
					logs: result.logs,
					...result.value !== void 0 ? { result: result.value } : {}
				};
			} finally {
				exec.signal.removeEventListener("abort", onOuterAbort);
			}
		},
		presentCall: (args) => ({
			card: "generic",
			title: args.description,
			kind: "execute",
			rawInput: args.code
		})
	});
	Object.defineProperty(definition, "description", {
		enumerable: true,
		get: () => resolveFlavor(peekRuntime).description
	});
	Object.defineProperty(definition, "parameters", {
		enumerable: true,
		get: () => parameterSchemaSpecToJsonSchema({
			code: {
				type: "string",
				required: true,
				description: resolveFlavor(peekRuntime).codeDescription
			},
			description: {
				type: "string",
				required: true,
				description: RUN_CODE_DESCRIPTION_PARAM_DESCRIPTION
			}
		})
	});
	return definition;
}
/**
* Code Mode codegen: the pure projection from registered tool schemas to the TypeScript SDK
* text the model programs against (the `tools:sdk` prompt section). Sibling of
* `json-schema.ts` — `schemas()` (native function calling) and this module (the generated
* `declare const tools` API) are two projections of the same store.
* @module @deepseek-ai/dsh-tools/src/ts-types
*/
/** Property names that are valid bare TS identifiers; anything else is quoted. */
const IDENTIFIER$1 = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
/** Render an object key: bare when it is a valid identifier, quoted otherwise (every name stays reachable, no aliasing). */
function renderKey(name) {
	return IDENTIFIER$1.test(name) ? name : JSON.stringify(name);
}
/** One `indent`-deep line prefix (two spaces per level). */
function pad$1(indent) {
	return "  ".repeat(indent);
}
/** A one-line JSDoc block for a schema `description`, or no lines when there is none. */
function docLines$1(description, indent) {
	if (typeof description !== "string" || description.length === 0) return [];
	const collapsed = description.replace(/\s+/g, " ").trim();
	return [`${pad$1(indent)}/** ${collapsed.replaceAll("*/", String.raw`*\/`)} */`];
}
/** Render one scalar already validated by the unified schema boundary. */
function renderScalar(value) {
	return JSON.stringify(value);
}
/** Render a validated scalar `const`/`enum`, falling back to the broad type. */
function renderConstrainedScalar$1(node, type) {
	const broad = type === "integer" ? "number" : type;
	if (Object.hasOwn(node, "const")) return renderScalar(node.const);
	if (Object.hasOwn(node, "enum")) return node.enum.map(renderScalar).join(" | ");
	return broad;
}
/** Build one document from captured parts while retaining the legacy array-parenthesization test. */
function typeDocumentFrom(parts) {
	return {
		parts,
		containsUnionOrIntersection: parts.some((part) => typeof part === "string" ? part.includes("|") || part.includes("&") : part.containsUnionOrIntersection)
	};
}
/** Build a small document without an intermediate array at each call site. */
function typeDocument(...parts) {
	return typeDocumentFrom(parts);
}
/** Flatten a nested document with an explicit work stack. */
function flattenTypeDocument(document) {
	const chunks = [];
	const tasks = [document];
	for (let task = tasks.pop(); task !== void 0; task = tasks.pop()) {
		if (typeof task === "string") {
			chunks.push(task);
			continue;
		}
		for (let index = task.parts.length - 1; index >= 0; index--) {
			const part = task.parts[index];
			/* v8 ignore next -- the loop is bounded by the captured part count. */
			if (part !== void 0) tasks.push(part);
		}
	}
	return chunks.join("");
}
/** Initialize one schema-render frame with empty aggregation state. */
function schemaRenderFrame(node, indent) {
	return {
		node,
		indent,
		phase: "start",
		children: [],
		childIndex: 0,
		childDocuments: [],
		entries: []
	};
}
/** Render an already asserted schema to a composable document. */
function renderSupportedSchema(schema, indent) {
	const frames = [schemaRenderFrame(schema, indent)];
	let rootDocument;
	const finish = (document) => {
		frames.pop();
		const parent = frames.at(-1);
		if (parent === void 0) rootDocument = document;
		else parent.childDocuments.push(document);
	};
	while (frames.length > 0) {
		const frame = frames.at(-1);
		/* v8 ignore next -- the loop condition guarantees a current frame. */
		if (frame === void 0) break;
		if (frame.phase === "children") {
			if (frame.childIndex < frame.children.length) {
				const child = frame.children[frame.childIndex];
				/* v8 ignore next -- childIndex is bounded by children.length. */
				if (child === void 0) throw new Error("missing schema render child");
				frame.childIndex++;
				frames.push(schemaRenderFrame(child.node, child.indent));
				continue;
			}
			if (frame.kind === "oneOf") {
				const parts = [];
				for (let index = 0; index < frame.childDocuments.length; index++) {
					if (index > 0) parts.push(" | ");
					const child = frame.childDocuments[index];
					/* v8 ignore next -- child documents correspond one-to-one with children. */
					if (child !== void 0) parts.push(child);
				}
				finish(typeDocumentFrom(parts));
				continue;
			}
			if (frame.kind === "array") {
				const child = frame.childDocuments[0];
				/* v8 ignore next -- array frames always schedule exactly one child. */
				if (child === void 0) throw new Error("missing array item type");
				finish(child.containsUnionOrIntersection ? typeDocument("(", child, ")[]") : typeDocument(child, "[]"));
				continue;
			}
			const required = new Set(frame.node.required);
			const parts = ["{"];
			for (let index = 0; index < frame.entries.length; index++) {
				const entry = frame.entries[index];
				const child = frame.childDocuments[index];
				/* v8 ignore next -- object entries and child documents have the same length. */
				if (entry === void 0 || child === void 0) throw new Error("missing object property type");
				const [name, prop] = entry;
				for (const line of docLines$1(prop.description, frame.indent + 1)) parts.push("\n", line);
				parts.push("\n", `${pad$1(frame.indent + 1)}${renderKey(name)}${required.has(name) ? "" : "?"}: `, child, ";");
			}
			parts.push("\n", `${pad$1(frame.indent)}}`);
			const declared = typeDocumentFrom(parts);
			finish(frame.node.additionalProperties === false ? declared : typeDocument(declared, " & Record<string, JsonValue>"));
			continue;
		}
		const node = frame.node;
		if (node.oneOf !== void 0) {
			frame.kind = "oneOf";
			frame.children = Array.from(node.oneOf, (child) => ({
				node: child,
				indent: frame.indent
			}));
			frame.childIndex = 0;
			frame.childDocuments = [];
			frame.phase = "children";
			continue;
		}
		if (node.type === void 0) {
			finish(typeDocument("JsonValue"));
			continue;
		}
		switch (node.type) {
			case "string":
			case "number":
			case "integer":
			case "boolean":
			case "null":
				finish(typeDocument(renderConstrainedScalar$1(node, node.type)));
				break;
			case "array":
				if (node.items === void 0) finish(typeDocument("JsonValue[]"));
				else {
					frame.kind = "array";
					frame.children = [{
						node: node.items,
						indent: frame.indent
					}];
					frame.childIndex = 0;
					frame.childDocuments = [];
					frame.phase = "children";
				}
				break;
			case "object": {
				const open = node.additionalProperties !== false;
				const entries = Object.entries(node.properties ?? {});
				if (entries.length === 0) finish(typeDocument(open ? "Record<string, JsonValue>" : "Record<string, never>"));
				else {
					frame.kind = "object";
					frame.entries = entries;
					frame.children = entries.map(([, child]) => ({
						node: child,
						indent: frame.indent + 1
					}));
					frame.childIndex = 0;
					frame.childDocuments = [];
					frame.phase = "children";
				}
				break;
			}
			/* v8 ignore next -- assertSupportedJsonSchema narrowed this closed type union. */
			default: finish(typeDocument("unknown"));
		}
	}
	/* v8 ignore next -- every root frame produces one document. */
	return rootDocument ?? typeDocument("unknown");
}
/**
* Map one enforced JSON-Schema node to a TypeScript type literal. Supports
* every unified schema construct and returns `unknown` for malformed or
* unsupported inputs without throwing.
* @param schema - the JSON-Schema node (any shape; hostile inputs degrade).
* @param indent - the indentation level for nested object members.
* @returns the TS type text (multi-line for objects with properties).
*/
function jsonSchemaToTs(schema, indent = 0) {
	try {
		assertSupportedJsonSchema(schema);
		return flattenTypeDocument(renderSupportedSchema(schema, indent));
	} catch {
		return "unknown";
	}
}
/** The fixed model-facing usage contract rendered above the declarations (see the Code Mode Agent Note's "What the model sees"). */
const SDK_INSTRUCTIONS$1 = `## Writing code for run_code

\`run_code\` takes two required arguments: \`code\` — the body of an async TypeScript function (erasable syntax only — no \`enum\` or namespaces; type annotations are advisory, the code runs type-stripped) — and \`description\`, a short summary of what the program does. Inside the program:

- Call tools as \`await tools.name(args)\` — quoted access for exotic names: \`tools["my-tool"](args)\`. Every call resolves to the tool's typed canonical JSON value. Tool arguments must be lossless JSON.
- A FAILED tool call rejects with \`ToolCallError\`, whose \`toolName\` identifies the failed tool and whose \`message\` is human-readable — \`try/catch\` it to handle and continue.
- Independent read-only calls MAY overlap under \`Promise.all\` (safe calls run concurrently; mutating calls run alone, in submission order). Sequence dependent work with \`await\`.
- Emit results with \`return\` and/or \`console.log(...)\`. Only what you print or return is program output. A successful tool result containing an image is attached after the run so you can inspect it on the next step; every other intermediate result stays out of the conversation, so extract just what you need.

The available tools:`;
/**
* Render the full `tools:sdk` prompt section: the fixed usage instructions
* plus one `declare const tools` interface covering every given tool.
* Deterministic — tools are emitted in lexicographic name order, so an
* unchanged tool set produces byte-identical text across assemblies. The sort
* is not a total order on byte-equal names, so two schemas sharing a name
* would render in argument order; the caller's visible-capability map is keyed
* by name, so the input never carries a duplicate.
* @param schemas - the tool schemas to declare (the caller excludes
*   `run_code` itself).
* @returns the complete section text.
*/
function renderToolsSdk(schemas) {
	const sorted = [...schemas].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
	const argsMembers = [];
	const outputMembers = [];
	for (const schema of sorted) {
		argsMembers.push(...docLines$1(schema.description, 1));
		argsMembers.push(`${pad$1(1)}${renderKey(schema.name)}: ${jsonSchemaToTs(schema.parameters, 1)};`);
		outputMembers.push(`${pad$1(1)}${renderKey(schema.name)}: ${jsonSchemaToTs(schema.output, 1)};`);
	}
	return `${SDK_INSTRUCTIONS$1}\n\n\`\`\`ts\ntype JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }\n\n${[
		`interface ToolArgsMap {${argsMembers.length > 0 ? `\n${argsMembers.join("\n")}\n` : ""}}`,
		`interface ToolOutputMap {${outputMembers.length > 0 ? `\n${outputMembers.join("\n")}\n` : ""}}`,
		"type ToolName = keyof ToolOutputMap",
		[
			"declare class ToolCallError extends Error {",
			"  readonly name: \"ToolCallError\";",
			"  readonly toolName: ToolName;",
			"}"
		].join("\n"),
		[
			"declare const tools: {",
			"  [K in ToolName]: (args: ToolArgsMap[K]) => Promise<ToolOutputMap[K]>;",
			"}"
		].join("\n")
	].join("\n\n")}\n\`\`\``;
}
/**
* Code Mode codegen — Python flavor. The pure projection from registered tool schemas to the
* Python SDK text the model programs against under `runtime.language === 'python'`. Sibling of
* {@link ./ts-types.ts | ts-types.ts}; the two files are two projections of the same registry
* store, keyed by the loaded {@link @deepseek-ai/dsh-code-runtime#CodeRuntime.language | code
* runtime's language}.
*
* Under `mode: 'code'` the native tool schemas are omitted from the request, so this generated
* SDK is the model's ONLY source for each tool's argument names, required fields, types,
* descriptions, and canonical output shapes; under `mode: 'both'` the native schemas ship
* alongside it and it is one of two. Object-shaped arguments and outputs therefore render as one
* named `TypedDict` per tool (and per nested object), not an opaque `dict[str, Any]`, so the
* shape survives into the program under the mode that has nothing else to carry it.
* @module @deepseek-ai/dsh-tools/src/py-types
*/
/**
* The reference grammar's `xid_start xid_continue*` — the set
* `str.isidentifier()` accepts on a CPython whose Unicode tables match the
* engine's. See {@link isBareIdentifier} for what a version skew does.
*/
const IDENTIFIER = /^[\p{XID_Start}_]\p{XID_Continue}*$/u;
/**
* Whether a name can be emitted as a bare Python identifier rather than
* routed to the subscript/`dict[str, Any]` path.
*
* Python identifiers are not ASCII: `路径` is as legal a field name as `path`,
* and rejecting it would degrade the whole enclosing object, dropping every
* field's name, requiredness, and type — information whose only source under
* `mode: 'code'` is this generated text.
*
* NFKC stability is a second and separate condition, because CPython
* normalizes identifiers at compile time while JSON keys are compared as
* written: `ﬁeld` would be declared and reachable as `field`, so the SDK would
* advertise a key under a spelling the harness never accepts, and two keys
* that normalize together would collapse into one declaration. Those names
* take the subscript path, which carries their exact bytes.
*
* `IDENTIFIER` matches `str.isidentifier()` (measured on Node 22.23.1 vs
* CPython 3.9.6 tables): the equivalence holds inside the two versions' shared
* tables, and the skew characters below are exactly where that pair diverges.
* The predicate as a whole is deliberately stricter than `isidentifier()`,
* which does not test NFKC stability: `'ﬁeld'.isidentifier()` is True and
* this returns false.
*
* Both conditions are evaluated against the ENGINE's Unicode tables, and the
* two sides are versioned independently — `\p{XID_Start}`/`\p{XID_Continue}`
* follow the running engine (Node 22.23.1 reports Unicode 17.0) while CPython
* follows its own (3.9.6 reports 13.0.0). The skew is not symmetric. A CPython
* older than the engine is the dangerous direction: a character added to either
* property since its tables (U+10570 Vithkuqi and U+1E290 Toto, 14.0; U+1E4D0
* Nag Mundari, 15.0; U+1C89 Cyrillic TJE, 16.0 — ages per `DerivedAge.txt`; all
* four are NFKC-stable and accepted here, and all four are `Cn` on that 3.9.6,
* which rejects them) is emitted bare and its tokenizer refuses the character,
* taking the whole SDK block down — the same parseability invariant
* {@link UNPRINTABLE}, {@link LONE_SURROGATE} and {@link MAX_LIST_NESTING}
* exist for. Both properties carry it: a character added only to `XID_Continue`
* passes the trailing `\p{XID_Continue}*` in a tail position and fails the same
* way — U+200C ZWNJ and U+200D ZWJ are that case, gaining `XID_Continue` in UCD
* 15.1 and absent from it in 13.0.0, 14.0.0 and 15.0.0, so `a\u{200C}b` is
* emitted bare here while `isidentifier()` is False on 3.9.6 and on 3.12.13
* (15.0.0). A CPython newer than the engine only routes a legal name to the
* subscript/`dict[str, Any]` path: less readable, still correct. The NFKC
* condition reduces to the same skew, since normalization stability guarantees
* an assigned character's normalization never changes afterwards.
*
* This predicate is not the only reader of engine tables. {@link camelCase}
* reads them at three further points — its split set, its head test, and its
* `toUpperCase()` case mapping — and this predicate's verdict gates none of
* them: a class name derived there reaches emitted text whenever any object
* shape in the tool's schema declares a `TypedDict`, including for a tool this
* predicate rejected. A tool named `zz-\u{1E4D0}x` with such parameters never
* reaches the skew here (the `-` rejects it outright) yet emits `class
* Zz\u{1E4D0}xArgs`, which that same 3.9.6 refuses — Nag Mundari arrived two
* releases after its tables. The case mapping is a separate table rather than
* an XID membership test, and it fails on names both conditions above accept:
* `\u{019B}` is XID_Start and NFKC-stable, so this predicate accepts it and
* `async def \u{019B}` compiles on 3.9.6, but Node uppercases it to
* `\u{A7DC}` — unassigned in that CPython, whose own `.upper()` is the identity
* here — and the declared `class \u{A7DC}Args` fails with `invalid
* non-printable character U+A7DC`. Closing the exposure therefore covers all
* four read points, not this predicate alone; it needs the target interpreter's
* version, which the backend reporting `language: 'python'` owns; the
* language-dispatch Agent Note records the deferral.
*
* The `ts-types` sibling keeps its own ASCII rule rather than sharing this
* one: ECMAScript identifiers are a different set (`$`) and are never
* normalized, so one predicate cannot be correct for both. ZWJ/ZWNJ are not
* part of that difference — both sets carry them on the engine's tables; what
* separates the two there is the CPython table version above.
* @param name - the raw schema field or tool name.
* @returns whether the name can be emitted bare.
*/
function isBareIdentifier(name) {
	return IDENTIFIER.test(name) && name.normalize("NFKC") === name;
}
/**
* Python hard keywords: reserved everywhere, so a tool or field named
* ``class`` or ``lambda`` is legal on the wire but not as an attribute
* (``tools.class`` would be a SyntaxError in the model program) and not as a
* class-syntax `TypedDict` field. Such a tool renders under subscript access
* and such an object degrades to ``dict[str, Any]`` — the model still reaches
* every tool and field without collisions.
* Soft keywords (``match``, ``case``, ``type``, ``_`` — the language
* reference's whole set) are deliberately ABSENT: each is special in exactly
* one syntactic position — a statement head (``match``, ``type``), a ``match``
* statement's clause head (``case``), or a pattern (``_``) — so ``match: str``
* as a field and ``async def match(...)`` as a method are both legal, and
* including them would needlessly degrade common search/regex tool fields to
* ``dict[str, Any]``. Underscore-leading names are handled separately, not
* here: a non-dunder ``__token`` name-mangles, a dunder present on
* ``object``/``type`` resolves before the proxy hook, and implicit
* special-method lookup bypasses the hook.
*/
const RESERVED = new Set([
	"False",
	"None",
	"True",
	"and",
	"as",
	"assert",
	"async",
	"await",
	"break",
	"class",
	"continue",
	"def",
	"del",
	"elif",
	"else",
	"except",
	"finally",
	"for",
	"from",
	"global",
	"if",
	"import",
	"in",
	"is",
	"lambda",
	"nonlocal",
	"not",
	"or",
	"pass",
	"raise",
	"return",
	"try",
	"while",
	"with",
	"yield",
	"__debug__"
]);
/** `typing` symbols this module may emit, in the deterministic import order. */
const TYPING_ORDER = [
	"Any",
	"Literal",
	"NotRequired",
	"Protocol",
	"TypedDict"
];
/** `indent`-deep line prefix (four spaces per level to match PEP 8 output). */
function pad(indent) {
	return "    ".repeat(indent);
}
/**
* The `Cc` code points that survive the whitespace collapse in {@link describe}
* and have no printable form: the C0 controls, DEL, and the C1 controls. Only
* U+0009 to U+000D are absent, because ECMAScript `\s` already collapsed them —
* `\s` is TAB/VT/FF/SP/NBSP/ZWNBSP/Zs plus LF/CR/LS/PS, so no C1 code point is
* in it and the whole U+0080 to U+009F block reaches this rule intact. Those
* are not hypothetical input: they are what Windows-1252 bytes 0x80 to 0x9F
* (smart quotes, em dash) become when decoded as Latin-1.
* CPython rejects source containing a NUL outright
* (`SyntaxError: source code string cannot contain null bytes`), whether it
* sits in a docstring or in a comment, so one such byte anywhere in a schema
* description would make the whole generated SDK unparseable — under
* `mode: 'code'`, the model's only declaration of the tools. The rest are
* legal but invisible; escaping them with the same rule keeps the emitted text
* readable and the treatment uniform.
*
* The boundary is the category, not per-code-point addressability: `\xNN`
* addresses U+0000 to U+00FF, so one escape form covers `Cc` exactly. The
* invisible `Cf` formatting characters pass through by design — of them only
* U+00AD soft hyphen would fit `\xNN` at all, and escaping that one while
* U+200B ZWSP, U+200E/U+200F bidi marks, and U+2060 word joiner passed through
* would leave a rule that is neither category- nor addressability-shaped. The
* whole family is legal in both consumers, since only LF and CR terminate a
* Python string literal or a `#` comment. That set is the tokenizer's, not
* `str.splitlines()`': NEL (U+0085), LS (U+2028), and PS (U+2029) split a
* string at run time but do not end a physical line in source — measured on
* CPython 3.9.6 and 3.12.13, each accepted in both positions with the value
* round-tripping — so they are safe raw wherever they reach emitted text
* unescaped, which for all three is `JSON.stringify`, at two call sites:
* {@link pyScalar}'s literal path, and the subscript tool-name comment's own
* call, which a name carrying any of them always reaches, none being
* `XID_Continue`. The `description` path escapes NEL under the class above and
* folds LS and PS in {@link describe}'s `\s+` collapse, both being `\s`.
*/
const UNPRINTABLE = /[\u0000-\u0008\u000e-\u001f\u007f-\u009f]/g;
/**
* Unpaired surrogate code points, escaped by {@link describe} as `\uNNNN` —
* its own form, since `\xNN` stops at U+00FF. The `u` flag is what makes this
* the LONE ones: in Unicode mode a well-formed pair is a single astral code
* point outside D800 to DFFF, so an emoji in a description survives untouched.
*
* This is the NUL case from {@link UNPRINTABLE}, not the invisible-character
* case. Python source must be UTF-8-encodable and a lone surrogate is not, so
* `compile()` raises `UnicodeEncodeError: surrogates not allowed` for one
* anywhere in the text — measured on 3.9 for a string literal and for a `#`
* comment alike. A raw or MCP tool description reaches this: `JSON.parse` on a
* wire `"\ud800"` escape yields exactly such a code point.
*/
const LONE_SURROGATE = /[\ud800-\udfff]/gu;
/**
* The collapsed one-line `description` of a schema node (byte-stable across
* formatting churn), or `undefined` when the node carries none. Every caller
* passes an object — a validated property node, the `ToolSdkSchema` itself, or
* the `{ description }` wrapper {@link docLines} synthesizes — so only the
* description field needs guarding. A description that collapses
* to nothing (empty, or whitespace only) is `undefined` too: it documents the
* node no better than an absent one, and emitting it would leave an empty
* `"""` docstring or a bare `#   ` line in the SDK. Only ECMAScript whitespace
* folds, so a description of whitespace plus one surviving control character is
* NOT absent: it collapses to that character's visible escape.
*
* Control characters left over after the whitespace collapse are rendered as
* their `\xNN` escapes (see {@link UNPRINTABLE}) and unpaired surrogates as
* their `\uNNNN` escapes (see {@link LONE_SURROGATE}); the escape's own backslash is
* emitted literally by both consumers, since {@link docLines} doubles it into a
* Python source escape and a `#` comment carries it verbatim.
*/
function describe(schema) {
	const description = schema.description;
	if (typeof description !== "string") return void 0;
	const collapsed = description.replace(/\s+/g, " ").replace(UNPRINTABLE, (char) => `\\x${char.charCodeAt(0).toString(16).padStart(2, "0")}`).replace(LONE_SURROGATE, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`).trim();
	return collapsed.length === 0 ? void 0 : collapsed;
}
/**
* One-line docstring for a tool `description`, or no lines when there is none.
* Backslashes are doubled first, every quote is escaped, and a trailing
* backslash cannot survive: a description ending in `"` or an odd backslash
* would otherwise merge with (or escape) the closing triple quote and make
* the generated block — Code Mode's only SDK — syntactically invalid Python.
*/
function docLines(description, indent) {
	const collapsed = describe({ description });
	if (collapsed === void 0) return [];
	const escaped = collapsed.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
	return [`${pad(indent)}"""${escaped}"""`];
}
/**
* CamelCase a name into a Python type identifier: non-identifier characters
* split words, `_` splits too (it is `XID_Continue`, so the split set names it
* explicitly), and a head that cannot start an identifier takes a `Tool`
* prefix. Unicode survives, so a `路径` field yields `路径`-based class names
* instead of collapsing to the bare prefix. A character that is not
* `XID_Continue` splits even when it is a letter, so a name whose NFKC folding
* would leave the identifier set is not carried through — the split set is the
* grammar's, not an ASCII approximation of it.
*
* The result is NFKC-normalized: these names are generated, never matched
* against a JSON key, so normalizing is free here and keeps what CPython
* compiles identical to what is emitted — unlike {@link isBareIdentifier},
* which must reject unstable names outright. Normalizing AFTER the prefix
* decision is what makes that hold at the seam the prefix creates: `Tool` +
* a combining-mark head composes there (`U+0301` gives `Tooĺ`, U+013A), so
* normalizing only the un-prefixed part would emit a name CPython compiles to
* a different symbol. The second call is idempotent on the un-prefixed arm.
*
* The split set, the head test, and `toUpperCase()` all read the engine's
* Unicode tables, so this function carries the same version skew
* {@link isBareIdentifier} documents, by paths independent of it: a class name
* derived here reaches emitted text whenever any object shape in the tool's
* schema declares a `TypedDict`, and the predicate's verdict on the tool name
* does not gate that. The case mapping is the one that can fail on a name the
* predicate accepted; the worked example is there.
* @param raw - the schema field or tool name to derive from.
* @returns a class-name segment safe to emit.
*/
function camelCase(raw) {
	const joined = raw.split(/[^\p{XID_Continue}]+|_+/u).filter((part) => part.length > 0).map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join("").normalize("NFKC");
	return (/^\p{XID_Start}/u.test(joined) ? joined : `Tool${joined}`).normalize("NFKC");
}
/** Class-name base cap keeping each emitted name — and total text — linear in schema depth. */
const MAX_CLASS_NAME_BASE = 120;
/**
* Deepest `list[…]` nesting emitted into one annotation before the item type
* degrades to `Any`. CPython's tokenizer rejects a logical line holding more
* than 200 simultaneously-open brackets (`MAXLEVEL`, `SyntaxError: too many
* nested parentheses`), so an array chain deeper than that would render an SDK
* block that is not valid Python at all — the same failure the docstring
* escaping in {@link docLines} exists to prevent. 180 leaves headroom for the
* few brackets an annotation can add around the chain, all of which count
* toward the same limit. Per emission site, counting brackets open at the
* chain's innermost point:
*
* - Return annotation, `async def f(self, args: X) -> chain:` — 180 `list[`
*   plus an innermost `Literal[`. The parameter list's `(` closed at the `)`
*   before the `->`, so it is NOT open here: 181.
* - TypedDict field, `field: NotRequired[chain]` — a class-body line with no
*   other open bracket, and its children start at `listDepth: 1` to reserve
*   the `NotRequired[`, so 179 `list[` plus `Literal[`: 181. Required fields
*   share that start for uniformity, spending one level of representable depth
*   on a bracket they never emit.
* - Argument annotation, `async def f(self, args: chain) -> Y:` — the `(` IS
*   still open around it: 180 `list[` plus `Literal[` plus the paren, 182, the
*   worst case. Reachable only through a raw `register()` whose `parameters`
*   is an array reached from the root through `oneOf` arms alone — the root
*   array itself, or one nested under any depth of unions, since an arm
*   inherits the enclosing depth unchanged (`A | B` opens no bracket). An
*   object ancestor takes it out of this case: its fields restart the chain at
*   the 181 site. `defineTool` compiles an object root, so the annotation is a
*   bare TypedDict class name or a one-bracket `dict[str, Any]` when that
*   object degrades — never a chain.
*
* A CPython grammar limit, not a deployment choice, so it is fixed rather than
* configurable. The sibling `ts-types` renderer needs no counterpart: nothing
* in the TypeScript grammar bounds nesting, and its SDK block is never type-
* checked. Only bracket nesting counts — a `oneOf` renders as a flat `A | B`
* chain and nested objects render as separate `class` statements, so neither
* accumulates open brackets at any depth. The invariant this cap serves is
* grammatical validity; see the `oneOf` arm in {@link renderType} for the one
* interpreter limit deliberately left uncapped.
*/
const MAX_LIST_NESTING = 180;
/**
* Cap a class-name base at {@link MAX_CLASS_NAME_BASE} (see the callers for
* why capping keeps the render linear). `slice` counts UTF-16 code units, so
* an astral character straddling the boundary would be cut in half and leave a
* lone surrogate — not an identifier character, and not even well-formed text;
* drop it rather than emit it.
*/
function capClassNameBase(base) {
	if (base.length <= MAX_CLASS_NAME_BASE) return base;
	const capped = base.slice(0, MAX_CLASS_NAME_BASE);
	return /[\uD800-\uDBFF]$/.test(capped) ? capped.slice(0, -1) : capped;
}
/**
* Reserve a unique class name from a base, suffixing `2`, `3`, … on collision.
* The base is capped at {@link MAX_CLASS_NAME_BASE} first: child class names
* derive from their parent's allocated name (`ParentChild`), so an unbounded
* schema of single-field objects would otherwise grow each name by one field
* per level and the sum of all names to Θ(depth²). Capping the base keeps each
* name — and the total emitted text — linear in depth. Collisions resume from
* the per-base counter in `state.nextClassCounter` rather than rescanning from
* `2`, so a deep chain sharing one capped base stays O(1) per allocation
* (amortized) instead of Θ(depth²) in time.
*/
function allocateClassName(base, state) {
	const capped = capClassNameBase(base);
	let name = capped;
	if (state.usedClassNames.has(name)) {
		let n = state.nextClassCounter.get(capped) ?? 2;
		while (state.usedClassNames.has(`${capped}${n}`)) n++;
		name = `${capped}${n}`;
		state.nextClassCounter.set(capped, n + 1);
	}
	state.usedClassNames.add(name);
	return name;
}
/**
* Append a child-name segment to a parent class-name base, capping the result
* at {@link MAX_CLASS_NAME_BASE}. Capping AT PROPAGATION (not only inside
* {@link allocateClassName}) keeps each level O(1): a deep `oneOf`- or
* object-chain would otherwise carry an ever-growing ConsString down the tree
* and re-materialize it (via `.length`/`.slice`) at every level — Θ(depth²).
* The bounded base plus the collision counter still yields unique names.
*
* The join is NFKC-normalized because both sides are separately normalized yet
* their concatenation need not be: a base ending in a Hangul L jamo or LV
* syllable composes with a following V or T jamo head (`가` + `ᆨ` gives `각`),
* so the emitted class name would differ from the symbol CPython compiles, and
* two byte-distinct names could fold onto one — `usedClassNames` dedupes by the
* raw bytes, so the collision counter would not see it. Normalizing costs
* O(cap + segment) per level, the same order as the `slice` it feeds. The other
* two join points need no counterpart: `Args`/`Output` start with `A`/`O` and
* {@link allocateClassName}'s suffix is digits, none of which compose backwards.
*/
function childClassName(base, segment) {
	return capClassNameBase(`${base}${segment}`.normalize("NFKC"));
}
/**
* Render one validated scalar as Python literal text (`True`/`False`,
* JSON-quoted strings, bare numbers). `null` cannot reach here: the `null`
* type renders directly as `None`, and the unified validator rejects a null
* `const`/`enum` entry on every other scalar type.
*
* A beyond-safe-range integral number takes `BigInt` digits rather than
* `String`: Python integers are arbitrary-precision, so the emitted digits ARE
* the value the model programs against, and `String` can give a different
* integer than the double holds (`2 ** 60` prints the rounded `...847000`, not
* the exact `...846976`) or no integer literal at all (`1e21` prints `1e+21`).
* `String`'s rounding is not a bug in it: `Number::toString` emits the shortest
* decimal string that re-reads to the same double, then pads to the exponent
* with zeros (1 significant digit for `1e20`, 16 for `2 ** 60`) — and when the
* shortest string is shorter than the double's exact value, those padded digits
* name an integer no double holds. Passing one back would have to cross the
* argument boundary as a JSON number — a double again — so the SDK would
* document a value no program can pass. `BigInt` needs no case split: where
* `String` is already exact (`2 ** 53`, `1e20`) the two agree byte for byte,
* and where it is not, `BigInt` is the exact one. The TS flavor needs no
* counterpart at all: its literal is re-read by a JS parser back into the same
* double.
*
* `JSON.stringify` is also what keeps this path's output parseable, and it is
* the only thing that does. It covers both classes of hazard: the two kinds of
* code point CPython refuses anywhere in source — NUL among the C0 controls,
* and the whole D800–DFFF unpaired-surrogate block, escaped under ES2019
* well-formed stringification, which the engines range guarantees — and the
* ones that break this line in particular, a bare `"` closing the literal
* early, a trailing odd backslash eating the closing quote, and a bare LF/CR
* ending it before its terminator. The `description` path carries
* {@link UNPRINTABLE} and {@link LONE_SURROGATE} because nothing quotes it,
* and folds newlines in {@link describe}.
*
* That leans on a coincidence worth naming: every escape `JSON.stringify` can
* emit (`\"`, `\\`, `\b`, `\f`, `\n`, `\r`, `\t`, `\uXXXX`) is also a Python
* escape denoting the same character, so the emitted `Literal[...]` both
* parses and decodes back to the value the schema declared. DEL, the C1
* controls (NEL among them), and LS/PS (U+2028/U+2029) do reach it raw —
* legal but invisible, byte-for-byte as in the TS flavor; escaping them is a
* both-flavors change. Those last three are legal here for the reason
* {@link UNPRINTABLE} records: they are `str.splitlines()` boundaries, not
* tokenizer line terminators. The subscript tool-name comment quotes its name
* through its own call to the same `JSON.stringify`, never through this
* function, and inherits both halves — escapes and pass-throughs alike.
*/
function pyScalar(value) {
	if (value === true) return "True";
	if (value === false) return "False";
	if (typeof value === "string") return JSON.stringify(value);
	if (typeof value === "number" && Number.isInteger(value) && !Number.isSafeInteger(value)) return BigInt(value).toString();
	return String(value);
}
/**
* Render a validated scalar `const`/`enum` as `Literal[...]`, falling back to
* the broad type. Deliberately deviates from PEP 586, which restricts `Literal`
* parameters to int/bool/str/bytes/enum/None: a non-integral number
* `const`/`enum` emits a float literal (`Literal[1.5]`) a strict checker would
* reject. An integral one does not deviate — {@link pyScalar} emits int digits,
* including for the beyond-safe-range values it widens through `BigInt`, and
* PEP 586 admits int parameters. Harmless either way — the stub is advisory
* prompt text, only required to parse — and keeping the exact value
* communicates the constraint to the model.
*/
function renderConstrainedScalar(node, broad, state) {
	if (node.const !== void 0) {
		state.typing.add("Literal");
		return `Literal[${pyScalar(node.const)}]`;
	}
	if (node.enum !== void 0) {
		state.typing.add("Literal");
		return `Literal[${node.enum.map(pyScalar).join(", ")}]`;
	}
	return broad;
}
/**
* Map one JSON-Schema node to a Python type expression, threading `state` to
* collect the `TypedDict` declarations and `typing` symbols a full render
* needs. `className` is the name to give an object node with properties (and
* the prefix for its nested objects). Handles every unified schema construct —
* `oneOf` (→ `X | Y`), `const`/`enum` (→ `Literal[...]`), `integer` (→ `int`),
* `null` (→ `None`) — and degrades an unsupported or malformed schema to `Any`
* without throwing, the same trusted-after-validation stance as the sibling
* {@link ./ts-types.ts | ts-types} renderer. {@link jsonSchemaToPy} is the
* context-free entry point; this is the collecting core.
*/
function renderType(schema, className, state) {
	const newFrame = (schema, className, listDepth) => ({
		schema,
		className,
		phase: "start",
		listDepth,
		children: [],
		childIndex: 0,
		childTypes: [],
		entries: []
	});
	try {
		assertSupportedJsonSchema(schema);
		const frames = [newFrame(schema, className, 0)];
		let result;
		const finish = (type) => {
			frames.pop();
			const parent = frames.at(-1);
			if (parent === void 0) result = type;
			else parent.childTypes.push(type);
		};
		while (frames.length > 0) {
			const frame = frames.at(-1);
			/* v8 ignore next -- the loop condition guarantees a current frame. */
			if (frame === void 0) break;
			if (frame.phase === "children") {
				if (frame.childIndex < frame.children.length) {
					const child = frame.children[frame.childIndex];
					/* v8 ignore next -- childIndex is bounded by children.length. */
					if (child === void 0) throw new Error("missing python render child");
					frame.childIndex++;
					frames.push(newFrame(child.schema, child.className, child.listDepth));
					continue;
				}
				if (frame.kind === "oneOf") {
					let union = "";
					for (const [index, childType] of frame.childTypes.entries()) union = index === 0 ? childType : `${union} | ${childType}`;
					finish(union);
					continue;
				}
				if (frame.kind === "array") {
					/* v8 ignore next -- the ?? arm needs a childless array frame, which start never builds. */
					finish(`list[${frame.childTypes[0] ?? "Any"}]`);
					continue;
				}
				const node = frame.node;
				const name = frame.allocated;
				/* v8 ignore next -- typeddict frames always set node and allocated at start. */
				if (node === void 0 || name === void 0) throw new Error("missing typeddict frame state");
				const required = new Set(node.required);
				const lines = [`class ${name}(TypedDict):`];
				for (let index = 0; index < frame.entries.length; index++) {
					const entry = frame.entries[index];
					const fieldType = frame.childTypes[index];
					/* v8 ignore next -- entries and childTypes correspond one-to-one. */
					if (entry === void 0 || fieldType === void 0) throw new Error("missing typeddict field type");
					const [field, fieldSchema] = entry;
					const description = describe(fieldSchema);
					if (description !== void 0) lines.push(`${pad(1)}# ${description}`);
					if (required.has(field)) lines.push(`${pad(1)}${field}: ${fieldType}`);
					else {
						state.typing.add("NotRequired");
						lines.push(`${pad(1)}${field}: NotRequired[${fieldType}]`);
					}
				}
				if (node.additionalProperties !== false) lines.push(`${pad(1)}# Additional keys beyond those declared are allowed.`);
				if (lines.length === 1) lines.push(`${pad(1)}pass`);
				state.classes.push(lines.join("\n"));
				finish(name);
				continue;
			}
			frame.phase = "children";
			const node = frame.schema;
			if (node.oneOf !== void 0) {
				frame.kind = "oneOf";
				frame.children = node.oneOf.map((branch, index) => ({
					schema: branch,
					className: childClassName(frame.className, `${index + 1}`),
					listDepth: frame.listDepth
				}));
				continue;
			}
			if (node.type === void 0) {
				state.typing.add("Any");
				finish("Any");
				continue;
			}
			switch (node.type) {
				case "string":
					finish(renderConstrainedScalar(node, "str", state));
					break;
				case "number":
					finish(renderConstrainedScalar(node, "float", state));
					break;
				case "integer":
					finish(renderConstrainedScalar(node, "int", state));
					break;
				case "boolean":
					finish(renderConstrainedScalar(node, "bool", state));
					break;
				case "null":
					finish("None");
					break;
				case "array":
					if (node.items === void 0) {
						state.typing.add("Any");
						finish("list[Any]");
						break;
					}
					if (frame.listDepth >= MAX_LIST_NESTING) {
						state.typing.add("Any");
						finish("Any");
						break;
					}
					frame.kind = "array";
					frame.children = [{
						schema: node.items,
						className: frame.className,
						listDepth: frame.listDepth + 1
					}];
					break;
				case "object": {
					const entries = Object.entries(node.properties ?? {});
					if (className === "" || !entries.every(([name]) => isBareIdentifier(name) && !RESERVED.has(name) && !(name.startsWith("__") && !name.endsWith("__")))) {
						state.typing.add("Any");
						finish("dict[str, Any]");
						break;
					}
					if (entries.length === 0 && node.additionalProperties !== false) {
						state.typing.add("Any");
						finish("dict[str, Any]");
						break;
					}
					frame.kind = "typeddict";
					frame.node = node;
					frame.allocated = allocateClassName(frame.className, state);
					state.typing.add("TypedDict");
					frame.entries = entries;
					/* v8 ignore next -- allocated is always set before children are built. */
					frame.children = entries.map(([field, child]) => ({
						schema: child,
						className: childClassName(frame.allocated ?? "", camelCase(field)),
						listDepth: 1
					}));
					break;
				}
				/* v8 ignore next 4 -- assertSupportedJsonSchema narrowed this closed type union. */
				default:
					state.typing.add("Any");
					finish("Any");
			}
		}
		/* v8 ignore next -- every root frame produces one expression. */
		return result ?? "Any";
	} catch {
		state.typing.add("Any");
		return "Any";
	}
}
/** The fixed model-facing usage contract rendered above the declarations. */
const SDK_INSTRUCTIONS = `## Writing code for run_code

\`run_code\` takes two required arguments: \`code\` — the body of an async Python function (top-level \`await\` and \`return\` both work) — and \`description\`, a short summary of what the program does. At run time exactly two of the names declared below are bound: \`tools\` and \`ToolCallError\`. Everything else is a STATIC STUB describing argument and return types — in particular the \`TypedDict\` classes do NOT exist at run time, so build arguments as plain \`dict\`/\`list\` JSON values: \`await tools.name({"field": 1})\`, never \`FooArgs(field=1)\`, which raises \`NameError\`. Inside the program:

- Call tools as \`await tools.name(args)\` — subscript access for exotic, reserved, or underscore-leading names: \`await tools["my-tool"](args)\`. Every call resolves to the tool's typed canonical JSON value (each method's return type below). Tool arguments must be lossless JSON.
- A FAILED tool call raises \`ToolCallError\`, whose \`toolName\` identifies the failed tool and whose message is human-readable — wrap in \`try/except\` to handle and continue.
- Independent read-only calls MAY overlap under \`asyncio.gather\` (safe calls run concurrently; mutating calls run alone, in submission order). Sequence dependent work with \`await\`.
- Emit the run's answer with \`print(...)\` and/or a top-level \`return <value>\`; the returned value must be lossless JSON. Only what you print and return is program output. A successful tool result containing an image is attached after the run so you can inspect it on the next step; every other intermediate result stays out of the conversation, so extract just what you need.

The available tools:`;
/**
* Render the full `tools:sdk` prompt section under `runtime.language ===
* 'python'`: the Python-flavored usage instructions plus one named `TypedDict`
* per tool argument or output object (and per nested object) and one awaitable
* method per visible tool on a `Tools` protocol — typed args in, the tool's
* canonical output value out — with a `tools: Tools` singleton the model calls
* into. The `typing` import line lists exactly the symbols the render used.
* Deterministic — tools are emitted in lexicographic name order, and class
* declarations precede the protocol in that same order (nested classes before
* the parent that references them), so an unchanged tool set produces
* byte-identical text across assemblies. The sort is not a total order on
* byte-equal names, so two schemas sharing a name would render in argument
* order; the caller's visible-capability map is keyed by name, so the input
* never carries a duplicate.
* @param schemas - the tool schemas plus canonical output schemas to declare
*   (the caller excludes `run_code` itself).
* @returns the complete section text.
*/
function renderToolsSdkPy(schemas) {
	const sorted = [...schemas].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
	const state = {
		classes: [],
		usedClassNames: /* @__PURE__ */ new Set(),
		nextClassCounter: /* @__PURE__ */ new Map(),
		typing: new Set(["Protocol"])
	};
	const members = [];
	let statements = 0;
	for (const schema of sorted) {
		const argType = renderType(schema.parameters, `${camelCase(schema.name)}Args`, state);
		const outputType = renderType(schema.output, `${camelCase(schema.name)}Output`, state);
		if (isBareIdentifier(schema.name) && !RESERVED.has(schema.name) && !schema.name.startsWith("_")) {
			const doc = docLines(schema.description, 2);
			members.push(doc.length > 0 ? `${pad(1)}async def ${schema.name}(self, args: ${argType}) -> ${outputType}:` : `${pad(1)}async def ${schema.name}(self, args: ${argType}) -> ${outputType}: ...`);
			members.push(...doc);
			statements += 1;
		} else {
			members.push(`${pad(1)}# tools[${JSON.stringify(schema.name)}](args: ${argType}) -> ${outputType}`);
			const description = describe(schema);
			if (description !== void 0) members.push(`${pad(1)}#   ${description}`);
		}
	}
	const body = (statements > 0 ? members : [`${pad(1)}pass`, ...members]).join("\n");
	const imports = TYPING_ORDER.filter((symbol) => state.typing.has(symbol));
	const classBlock = state.classes.length > 0 ? `${state.classes.join("\n\n")}\n\n` : "";
	return `${SDK_INSTRUCTIONS}\n\n\`\`\`python\n${`from typing import ${imports.join(", ")}\n\nclass ToolCallError(Exception):
    toolName: str\n\n${classBlock}class Tools(Protocol):\n${body}\n\ntools: Tools`}\n\`\`\``;
}
/**
* Tool registry, model presentation modes, and pre/guard/around/post/result
* execution pipeline.
* @module @deepseek-ai/dsh-tools
*/
/**
* Language → SDK-section renderer. The registry looks up the loaded
* `ctx.codeRuntime.language` in this table when assembling the `tools:sdk`
* section under a non-native mode; a runtime whose language is not a key
* fails the assembly loudly (same idiom as `toolOrder` violations). Adding a
* new backend language is three parallel edits — a {@link CodeSdkLanguage}
* member, an entry here, and a `RUN_CODE_FLAVORS` entry in `code-mode.ts` for
* its `run_code` schema strings — plus the renderer function this table points
* at. The `satisfies` clause pins this table's key set to that union, which
* the flavor table is checked against too, so any of the three left out is a
* typecheck failure. What no check reaches is the prose that names the values
* instead of deriving them: the seam's `dsh-code-runtime` README pair, its
* `CodeRuntime.language` JSDoc, and `docs/subsystems/code-runtime.md`
* with its zh pair, plus this package's own README pair and the
* {@link Config.mode} JSDoc.
*/
/**
* Prompt order of the `code` collapse statement: after the persona and before
* the 100-199 per-tool guidance band, so the model reads which tools it may
* call before it reads what each one is for.
*/
const COLLAPSE_SECTION_ORDER = 99;
/**
* The model-facing statement of the `code` collapse. Names the consequence
* (the call fails) and the route (inside the program), because a rule the
* model can only discover by being denied is one it corrects too late.
*/
const CODE_ONLY_INSTRUCTION = `\`${RUN_CODE_NAME}\` is the only tool you can call directly — a tool call naming any other tool fails. Reach every tool the SDK declares below from inside the program.`;
const SDK_RENDERERS = {
	typescript: renderToolsSdk,
	python: renderToolsSdkPy
};
/**
* Scheduler entry point omitted from the generated named service API.
* @internal
*/
const TOOL_RUNTIME_SCHEDULER = Symbol("@deepseek-ai/dsh-tools.scheduler");
/** Canonical error code for cancellation after a tool body was invoked. */
const TOOL_ABORTED = "ABORTED";
/** Canonical error code for cancellation before a tool body was invoked. */
const TOOL_ABORTED_BEFORE_DISPATCH = "ABORTED_BEFORE_DISPATCH";
/**
* Thrown (internally) when the model requests a tool that isn't registered.
* Extends {@link HarnessError} (`code: 'UNKNOWN_TOOL'`) so an unknown-tool
* failure is as routable as a tool-thrown one — retry/sandbox/replay code can
* distinguish it from a tool body's own error.
*/
var ToolNotFoundError = class extends HarnessError {
	/**
	* @param toolName - the name the caller asked for.
	* @param reachableFrom - how the model reaches this tool instead, when the
	*   name IS visible and only the presentation denies calling it directly.
	*   Omitted for a name that is registered nowhere.
	*/
	constructor(toolName, reachableFrom) {
		super(reachableFrom === void 0 ? `unknown tool "${toolName}"` : `unknown tool "${toolName}": ${reachableFrom}`, "UNKNOWN_TOOL");
		this.name = "ToolNotFoundError";
	}
};
/** Thrown when a tool body or post-policy value violates its declared output. */
var ToolOutputError = class extends HarnessError {
	/** Schema/value violations in validation order. */
	violations;
	constructor(toolName, violations) {
		super(`tool "${toolName}" returned invalid output: ${violations.join("; ")}`, "INVALID_TOOL_OUTPUT");
		this.name = "ToolOutputError";
		this.violations = violations;
	}
};
/** Convert one projector exception into the canonical invalid-output failure. */
function projectionError(toolName, projector, error) {
	return new ToolOutputError(toolName, [`output.${projector} failed: ${errorMessage(error)}`]);
}
/** Snapshot one projector result before later durable-result materialization. */
function snapshotProjection(toolName, projector, candidate) {
	try {
		const detached = snapshotJsonValue(candidate);
		if (detached === void 0) throw new ToolOutputError(toolName, [`output.${projector} returned non-lossless JSON`]);
		return detached;
	} catch (error) {
		if (error instanceof ToolOutputError) throw error;
		throw projectionError(toolName, projector, error);
	}
}
/** Snapshot one body or policy value into the canonical invalid-output failure class. */
function snapshotToolValue(toolName, candidate) {
	try {
		const detached = snapshotJsonValue(candidate);
		if (detached === void 0) throw new ToolOutputError(toolName, ["value is not lossless JSON"]);
		return detached;
	} catch (error) {
		if (error instanceof ToolOutputError) throw error;
		throw new ToolOutputError(toolName, [`value snapshot failed: ${errorMessage(error)}`]);
	}
}
/**
* Best-effort human-readable message from an arbitrary thrown value: Error
* instances use `.message`; non-Error objects with a string `message`
* property (e.g. `throw { message: 'denied' }`) use it too; everything else
* is stringified.
*/
function errorMessage(error) {
	try {
		if (error instanceof Error) return error.message;
		if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") return error.message;
		return String(error);
	} catch {
		return "<unprintable thrown value>";
	}
}
/** Derive one failure message from policy feedback without changing its rendered blocks. */
function failureMessageFromContent(content) {
	const text = content.map((block) => block.type === "text" ? block.text : `[${block.type} content]`).join("\n");
	return text.length > 0 ? text : "tool result blocked by post-execute policy";
}
/** Snapshot and freeze one durable tool-result projection or reject lossy data. */
function materializePresentation(candidate) {
	const detached = snapshotJsonValue(candidate);
	if (detached === void 0) throw new TypeError("tool result must be losslessly JSON-serializable");
	return deepFreeze$1(detached);
}
/** Structured `{ name, code }` for a thrown HarnessError, else undefined. */
function errorInfo(error) {
	try {
		return error instanceof HarnessError ? {
			name: error.name,
			code: error.code
		} : void 0;
	} catch {
		return;
	}
}
/** One scope's complete tool-registry contribution. */
var ToolLayer = class {
	tools;
	restrictions = new AnonymousEntries();
	guards = new AnonymousEntries();
	/**
	* Presentation this scope's agent declared for itself, shadowing the
	* deployment default. One cell rather than an entry table: two answers to
	* "which form does the model see" is a contradiction, not a merge.
	*/
	mode;
	constructor(scope) {
		this.tools = new NamedEntries((name) => /* @__PURE__ */ new Error(scope === void 0 ? `tool "${name}" is already registered (for a per-agent variant, register through that agent's \`agent.ctx\` instead)` : `tool "${name}" is already registered in this scope`));
	}
	/** Whether every contribution table in this aggregate layer is empty. */
	isEmpty() {
		return this.tools.isEmpty() && this.restrictions.isEmpty() && this.guards.isEmpty() && this.mode === void 0;
	}
	/** Whether every compiled restriction in this layer admits a global tool name. */
	admits(name) {
		for (const filter of this.restrictions.values()) if (filter.allow !== void 0 && !filter.allow.has(name) || filter.deny !== void 0 && filter.deny.has(name)) return false;
		return true;
	}
	/** First monotonic denial from this layer's live guard registrations. */
	guardReason(exec) {
		for (const guard of this.guards.values()) {
			const reason = guard(exec);
			if (reason !== void 0) return reason;
		}
	}
};
/** Resolve the run_code overlap cap at the owning config boundary (direct construction bypasses the Loader schema). */
function resolveMaxParallelSubCalls(value) {
	const maxParallelSubCalls = value ?? 10;
	if (!Number.isInteger(maxParallelSubCalls) || maxParallelSubCalls < 1) throw new Error("maxParallelSubCalls must be a positive integer");
	return maxParallelSubCalls;
}
(class extends Service {
	static inject = ["systemPrompt"];
	static Config = Schema.object({
		mode: Schema.union([
			"native",
			"code",
			"both"
		]).default("native"),
		maxParallelSubCalls: Schema.natural().min(1).default(10)
	});
	/** Internal staged view consumed by `dsh-agent-loop`'s parallel scheduler. */
	[TOOL_RUNTIME_SCHEDULER] = {
		prepare: (exec) => this.prepareScheduledExecution(exec),
		dispatch: (exec) => this.dispatchScheduledExecution(exec),
		finalize: (exec, result) => this.finalizeScheduledExecution(exec, result),
		finish: (exec, result) => this.finishScheduledExecution(exec, result)
	};
	/** Context deferred by a running tool body, keyed by its scheduler-owned execution. */
	deferredContexts = /* @__PURE__ */ new WeakMap();
	/** Executions whose tool body declared the current turn complete. */
	concludingExecutions = /* @__PURE__ */ new WeakSet();
	/** Original caller cancellation, kept outside the wrapper-mutable execution object. */
	cancellationStates = /* @__PURE__ */ new WeakMap();
	/** Definition-owned final content transform snapshotted before policy begins. */
	contentFinalizers = /* @__PURE__ */ new WeakMap();
	layers = new ScopedLayers((scope) => new ToolLayer(scope), () => {
		this.ctx.emit("tools/change");
	});
	/** Presentation for scopes that declare none; {@link presentAs} shadows it per scope. */
	defaultMode;
	maxParallelSubCalls;
	/**
	* Reserved presentation transport, kept outside the filterable registration
	* layers. Built on first need rather than at construction: which agents run
	* a code mode is no longer known when the service is constructed, and the
	* transport is stateless beyond its closures over `this`.
	*/
	codeTransport;
	constructor(ctx, config = {}) {
		super(ctx, "tools");
		this.defaultMode = config.mode ?? "native";
		this.maxParallelSubCalls = resolveMaxParallelSubCalls(config.maxParallelSubCalls);
		ctx.systemPrompt.tools((context) => this.wireSchemas(context.scope));
		if (this.defaultMode !== "native") {
			ctx.systemPrompt.section(this.collapseSection());
			ctx.systemPrompt.section(this.sdkSection());
		}
	}
	/**
	* The prompt statement of the `code` executor collapse, registered wherever
	* {@link sdkSection} is and rendering empty outside an effective `code`.
	*
	* Every tool contributes its own guidance section naming its tool, none of
	* them qualify how that tool is reached, and they all render before the SDK
	* (orders 100-199 against {@link SDK_SECTION_ORDER}). Without this the model
	* reads a catalog of tools it is told to use and no statement that only
	* `run_code` may be called, so it emits a native call, receives
	* `UNKNOWN_TOOL` for a tool the prompt just declared, and concludes the
	* deployment is inconsistent. {@link COLLAPSE_SECTION_ORDER} places the rule
	* before that guidance rather than after it.
	*
	* `both` renders empty: native calls do execute there, so the rule is false.
	* @returns the section registration.
	*/
	collapseSection() {
		return {
			name: "tools:code-only",
			order: COLLAPSE_SECTION_ORDER,
			text: (context) => this.modeFor(context.scope) === "code" ? CODE_ONLY_INSTRUCTION : ""
		};
	}
	/**
	* The generated-SDK prompt section, registered globally by a code-mode
	* deployment and per scope by {@link presentAs}.
	*
	* The body regenerates from the CALLING scope, and renders empty for an
	* agent presenting natively — an agent that opted out under a code-mode
	* deployment still sees the global registration, and an empty section is
	* dropped from the rendered prompt.
	* @returns the section registration.
	*/
	sdkSection() {
		return {
			name: "tools:sdk",
			order: 150,
			text: (context) => {
				const mode = this.modeFor(context.scope);
				if (mode === "native") return "";
				const runtime = this.requireCodeRuntime(mode);
				const render = SDK_RENDERERS[runtime.language];
				/* v8 ignore next -- requireCodeRuntime rejects an unknown language before this runs. */
				if (render === void 0) throw new Error(`dsh-tools: no SDK renderer for ${runtime.language}`);
				return render(this.sdkSchemas(context.scope));
			}
		};
	}
	/**
	* The presentation one scope's agent sees: its own declaration, else the
	* deployment default.
	* @param scope - the calling agent, or undefined for the global view.
	* @returns the resolved presentation mode.
	*/
	modeFor(scope) {
		const layers = this.layers.chainLayers(scope);
		for (let index = layers.length - 1; index >= 0; index -= 1) {
			const mode = layers[index]?.mode;
			if (mode !== void 0) return mode;
		}
		return this.defaultMode;
	}
	/**
	* The reserved `run_code` transport, built on first need.
	*
	* It never enters the global layer: per-agent restrictions must not remove
	* it, and a scoped registration must not shadow it. The visibility resolver
	* appends it after resolving the filterable global/scoped capability layers,
	* and only for scopes whose mode actually presents it.
	* @returns the shared transport definition.
	*/
	requireCodeTransport() {
		this.codeTransport ??= createRunCodeTool(this, {
			requireRuntime: () => this.requireCodeRuntime(this.defaultMode),
			peekRuntime: () => this.ctx.get("codeRuntime"),
			maxParallel: this.maxParallelSubCalls,
			shapeDispatchLog: (dispatch) => this.shapeDispatchLog(dispatch)
		});
		return this.codeTransport;
	}
	/**
	* Present the calling scope's tools in `mode` instead of the deployment
	* default. Nearest scope on the chain wins, so a preset's standing
	* declaration covers every agent joined under it.
	*
	* Scoped only, and one declaration per scope: this is how an agent preset
	* composes Code Mode agents beside native ones in the same process, and a
	* process-global override would be the `mode` config field instead.
	* @param mode - the presentation the covered agents' models see.
	* @returns the exact disposer that restores the deployment default.
	*/
	presentAs(mode) {
		const ctx = this.ctx;
		if (scopeOf(ctx) === void 0) throw new Error("tools.presentAs() requires a scoped context (agent.ctx): a context-global presentation is the `mode` config field on the tools row");
		return ctx.effect(function* () {
			yield this.layers.effect(ctx, (layer) => {
				if (layer.mode !== void 0) throw new Error(`tools.presentAs("${mode}") conflicts with "${layer.mode}" already declared for this scope; one composition selects one presentation`);
				layer.mode = mode;
				return () => {
					layer.mode = void 0;
				};
			}, { label: "tools.presentAs()" });
			if (mode !== "native") {
				yield ctx.systemPrompt.section(this.collapseSection());
				yield ctx.systemPrompt.section(this.sdkSection());
			}
		}.bind(this), "tools.presentAs()");
	}
	/**
	* Build one scope's wire schemas and names for prompt-order validation.
	* Restrictions do not make known tools invalid, but a mode collapse does.
	*/
	wireSchemas(scope) {
		const view = this.view(scope);
		const mode = this.modeFor(scope);
		if (mode === "native") return {
			schemas: [...view.visible.values()].map((definition) => this.schemaOf(definition, false)),
			knownNames: [...view.knownNames]
		};
		this.requireCodeRuntime(mode);
		const schemas = [...view.visible.values()].map((definition) => this.schemaOf(definition, false));
		if (mode === "code") return {
			schemas: schemas.filter((schema) => schema.name === RUN_CODE_NAME),
			knownNames: [RUN_CODE_NAME]
		};
		return {
			schemas,
			knownNames: [...view.knownNames, RUN_CODE_NAME]
		};
	}
	/**
	* Resolve the code runtime or throw the actionable misconfiguration error.
	* Read at use time (assembly / run_code execution), NOT via static
	* `inject`: an inject entry would hold `ctx.tools` — and every tool plugin
	* behind it — hostage to a code runtime existing even under `mode:
	* 'native'` (the loop's optional-backend idiom, same as
	* `sessionPersistence`).
	*
	* Assembly and `run_code` execution read separately, so the language is not
	* bound to a request. Harmless while one published backend exists — both
	* reads return the same flavor — but a reload that swapped in a second
	* language between them would hand a program written against one SDK to the
	* other. Binding it is deferred until a second backend ships (the first
	* point it is testable); rationale in the
	* [language-dispatch note](../../../../.agents/notes/implemented/feature/2026-07-31-code-mode-language-dispatch.md).
	*/
	requireCodeRuntime(mode) {
		const runtime = this.ctx.get("codeRuntime");
		if (!runtime) throw new Error(`dsh-tools: mode "${mode}" requires a code runtime — load a ctx.codeRuntime implementation (e.g. @deepseek-ai/dsh-code-runtime-worker-thread) or set tools mode to "native"`);
		if (!Object.hasOwn(SDK_RENDERERS, runtime.language)) {
			const known = Object.keys(SDK_RENDERERS).map((name) => JSON.stringify(name)).join(", ");
			throw new Error(`dsh-tools: no SDK renderer registered for runtime language ${JSON.stringify(runtime.language)} (known: ${known})`);
		}
		return runtime;
	}
	/**
	* Register globally or in the calling agent scope. Scoped tools shadow
	* globals; duplicates within one layer and the reserved `run_code` name fail.
	* @param definition - tool schema, execution, and optional finalization/presentation callbacks.
	* @returns the exact disposer that unregisters the tool.
	*/
	register(definition) {
		const name = definition.name;
		const output = definition.output;
		if (output === void 0 || typeof output !== "object" || typeof output.render !== "function" || output.presentationMeta !== void 0 && typeof output.presentationMeta !== "function") throw new TypeError(`tool "${name}" must declare output { schema, render, presentationMeta? }`);
		assertSupportedJsonSchema(output.schema);
		const timeoutMs = definition.timeoutMs;
		if (timeoutMs !== void 0 && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) throw new TypeError(`tool "${name}" timeoutMs must be a positive finite number`);
		if (name === "run_code") throw new Error(`tool name "${RUN_CODE_NAME}" is reserved for the Code Mode presentation transport and cannot be registered or shadowed`);
		return this.layers.effect(this.ctx, (layer) => layer.tools.insert(name, definition), { label: "tools.register()" });
	}
	/**
	* Restrict global tools for the calling agent scope. Empty filters, unknown
	* names, scope-local names, and reserved transport names fail. Restrictions
	* intersect; scoped registrations remain visible.
	* @param filter - global-tool mask: `allow` (keep only) and/or `deny` (remove).
	* @returns the exact disposer that lifts this restriction.
	*/
	restrict(filter) {
		const scope = scopeOf(this.ctx);
		if (scope === void 0) throw new Error("tools.restrict() requires a scoped context (agent.ctx): a context-global restriction would mask every agent — deny the tool for the intended agent instead");
		const allow = filter.allow;
		const deny = filter.deny;
		if (allow === void 0 && deny === void 0) throw new Error("tools.restrict({}) is a no-op: pass `allow` and/or `deny` (an empty filter is almost always a materialized-empty-config bug)");
		const compiled = {
			...allow !== void 0 ? { allow: new Set(allow) } : {},
			...deny !== void 0 ? { deny: new Set(deny) } : {}
		};
		if ([...allow ?? [], ...deny ?? []].includes("run_code")) throw new Error(`tools.restrict() cannot name reserved Code Mode presentation transport "${RUN_CODE_NAME}"; restrict end-capability tools instead`);
		const known = this.view(scope).restrictableNames;
		const unknown = [...allow ?? [], ...deny ?? []].filter((name) => !known.has(name));
		if (unknown.length > 0) throw new Error(`tools.restrict() names unknown global tool${unknown.length > 1 ? "s" : ""} ${unknown.map((n) => `"${n}"`).join(", ")}; known global tools: ${[...known].sort().join(", ") || "(none)"}`);
		return this.layers.effect(this.ctx, (layer) => layer.restrictions.append(compiled), { label: "tools.restrict()" });
	}
	/**
	* Register a monotonic guard after the extensible `tools/pre-execute`
	* waterfall. A plain-context guard applies globally; one registered through
	* `agent.ctx` applies only to that agent. Any matching guard may deny by
	* returning a reason, while no guard can force-allow a call another guard
	* denied. The exact effect disposer is returned for ordered ownership and
	* HMR cleanup.
	* @param guard - synchronous check; a returned string denies the execution.
	* @returns the exact disposer that unregisters the guard.
	*/
	guard(guard) {
		return this.layers.effect(this.ctx, (layer) => layer.guards.append(guard), {
			label: "tools.guard()",
			notify: false
		});
	}
	/** First monotonic denial from the global then the scope chain's guard layers, farthest first. */
	guardReason(exec) {
		const globalReason = this.layers.global.guardReason(exec);
		if (globalReason !== void 0) return globalReason;
		if (exec.agent === void 0) return void 0;
		for (const layer of this.layers.chainLayers(exec.agent)) {
			const reason = layer.guardReason(exec);
			if (reason !== void 0) return reason;
		}
	}
	/**
	* Resolve every registry fact one scope needs in one layer traversal. The
	* visible map applies restrictions to the INHERITED surface, then the
	* scope's own registrations and the reserved presentation transport; the
	* other sets retain the pre-restriction facts needed by restriction and
	* prompt-order validation.
	*
	* A restriction filters what a scope inherits — the global layer and every
	* ancestor layer on its chain — and never what its OWN layer registers.
	* That exemption is what a per-child capability filter has to keep intact:
	* the delegation runtime registers a child's reporting and structured-output
	* tools into the child's own layer, and a filter naming the capabilities the
	* child may use must not strip the machinery it answers through.
	*
	* Reading the exempt set as "the global layer" instead of "not mine" held
	* only while every model-facing tool sat in the host composition. Once
	* presets moved them onto the agent plane they became an ANCESTOR
	* contribution, so a child's filter silently stopped constraining anything
	* it was given.
	* @param scope - the viewing scope (the agent), or undefined for the global view.
	* @returns the complete derived view for that scope.
	*/
	view(scope) {
		const layers = this.layers.chainLayers(scope);
		const own = this.layers.peek(scope);
		const inherited = new Map(this.layers.global.tools.entries());
		for (const layer of layers) {
			if (layer === own) continue;
			for (const [name, definition] of layer.tools.entries()) inherited.set(name, definition);
		}
		const visible = /* @__PURE__ */ new Map();
		const knownNames = /* @__PURE__ */ new Set();
		const restrictableNames = /* @__PURE__ */ new Set();
		for (const [name, definition] of inherited) {
			knownNames.add(name);
			restrictableNames.add(name);
			if (layers.every((layer) => layer.admits(name))) visible.set(name, definition);
		}
		if (own !== void 0) for (const [name, definition] of own.tools.entries()) {
			knownNames.add(name);
			visible.set(name, definition);
		}
		if (this.modeFor(scope) !== "native") visible.set(RUN_CODE_NAME, this.requireCodeTransport());
		return {
			visible,
			knownNames,
			restrictableNames
		};
	}
	/**
	* Look up a tool as one scope sees it (scoped
	* shadows global; a restricted-away global reads as absent). Presenters pass
	* the calling agent so the rendered card matches the definition that
	* actually executed.
	* @param name - the tool name as registered.
	* @param scope - the viewing scope (the agent); omitted = the global view.
	* @returns the definition the scope resolves, or undefined when none is visible.
	*/
	get(name, scope) {
		return this.view(scope).visible.get(name);
	}
	/**
	* Resolve the definition that MAY EXECUTE for a call, applying the mode
	* collapse at the operation boundary that owns it. The registry view
	* (`get`) is presentation-agnostic; here a MODEL-DIRECT call under `code`
	* may only name the reserved `run_code` transport, while a nested
	* sub-dispatch (a `parent` token set — the `run_code` SDK calling a tool
	* it bound) may call any visible tool. Denial surfaces as `UNKNOWN_TOOL`
	* through the executor, matching an absent definition.
	* @param name - the tool name as registered.
	* @param scope - the viewing scope (the agent); omitted = the global view.
	* @param nested - whether the call is a transport sub-dispatch, not a model-direct call.
	* @returns the definition that may run, or undefined when the call must be rejected.
	*/
	resolveExecution(name, scope, nested) {
		const tool = this.get(name, scope);
		if (tool === void 0) return void 0;
		if (this.collapses(name, scope, nested)) return void 0;
		return tool;
	}
	/**
	* Project visible definitions onto the allowlisted model-facing schema fields,
	* excluding execution and presentation callbacks.
	* @param scope - the viewing scope (the agent); omitted = the global view.
	* @returns one deep-cloned schema per visible tool.
	*/
	schemas(scope) {
		return [...this.view(scope).visible.values()].map((definition) => this.schemaOf(definition, true));
	}
	/** Project visible callable tools onto the generated Code Mode SDK contract. */
	sdkSchemas(scope) {
		return [...this.view(scope).visible.values()].filter((definition) => definition.name !== RUN_CODE_NAME).map((definition) => {
			const output = snapshotJsonValue(definition.output.schema);
			/* v8 ignore next -- registration already validated and retained this schema as lossless JSON. */
			if (output === void 0) throw new Error(`tool "${definition.name}" output schema must be lossless JSON before SDK projection`);
			return {
				...this.schemaOf(definition, true),
				output
			};
		});
	}
	/** Project one definition onto the model-facing schema fields. */
	schemaOf(definition, detachParameters) {
		const { name, description, parameters } = definition;
		const detached = detachParameters ? snapshotJsonValue(parameters) : parameters;
		if (detached === void 0) throw new Error(`tool "${name}" parameters must be lossless JSON before schema projection`);
		return {
			name,
			description,
			parameters: detached
		};
	}
	/**
	* Classify a pending call through the caller's visible tool definition. Only
	* an exact `true` is parallel; unknown, hidden, undeclared, invalid, or
	* throwing classifiers are exclusive.
	* @param exec - call name, parsed arguments, and optional agent scope.
	* @returns the fail-closed scheduling mode.
	*/
	executionMode(exec) {
		const tool = this.resolveExecution(exec.name, exec.agent, exec.parent !== void 0);
		if (!tool?.isConcurrencySafe) return { kind: "exclusive" };
		try {
			return tool.isConcurrencySafe(exec.arguments) === true ? { kind: "parallel" } : { kind: "exclusive" };
		} catch {
			return { kind: "exclusive" };
		}
	}
	/**
	* Run the `tools/code-dispatch-log` waterfall over one settled sub-dispatch
	* and return the content the bridge should log on `tool/code-dispatch`.
	* Contained: when a listener throws, the method logs the original settled
	* content; that failure must not fail the dispatch or omit the settle event. Private:
	* the ONE consumer is the `run_code` bridge this registry constructs, which
	* receives it as a capability parameter (the `requireRuntime` idiom) — the
	* waterfall, not this invoker, is the public extension point.
	*/
	async shapeDispatchLog(dispatch) {
		try {
			return await this.ctx.waterfall(scopeTarget(this, dispatch.agent), "tools/code-dispatch-log", dispatch, () => Promise.resolve(dispatch.content));
		} catch (error) {
			this.ctx.logger.warn(`tools: code-dispatch-log listener failed for ${dispatch.name}: ${errorMessage(error)}; logging the original settled content`);
			return dispatch.content;
		}
	}
	/**
	* Whether the `code` mode collapse denies a model-direct call: only the
	* reserved `run_code` transport may be named. Nested sub-dispatches (a
	* `parent` token set) bypass the collapse. One home for the
	* security-relevant predicate, shared by {@link resolveExecution} and
	* {@link createExecution} so the two can never drift apart.
	*
	* Resolved through {@link modeFor}, NOT `defaultMode`: an agent given `code`
	* by an agent preset under a native deployment is the composition
	* `dsh-agent-tool-presentation` exists for, and reading the deployment default would
	* leave exactly that agent uncollapsed — announcing one surface while
	* executing another, which is the bypass this collapse closes.
	* @param name - the tool name as registered.
	* @param scope - the viewing scope whose effective presentation mode applies.
	* @param nested - whether the call is a transport sub-dispatch, not a model-direct call.
	*/
	collapses(name, scope, nested) {
		return !nested && this.modeFor(scope) === "code" && name !== "run_code";
	}
	/**
	* Execute through pre-policy, guards, around-dispatch, post-policy,
	* definition-owned content finalization, and final notification. Tool and
	* listener failures resolve as materialized error results; an invisible tool
	* reports `UNKNOWN_TOOL`. The returned outcome is the same lossless, frozen
	* snapshot final observers receive. Cancellation
	* arriving after entry and before final result materialization skips a
	* not-yet-started body with `ABORTED_BEFORE_DISPATCH` or replaces a
	* successful started outcome with `ABORTED`; already-started work is still
	* drained and may retain a tool-owned structured error.
	* @param exec - the typed same-process call input. The registry assigns its
	*   correlation token before policy begins.
	* @returns the materialized final result.
	*/
	async execute(exec) {
		return this.prepareExecution(exec, (prepared) => this.completeScheduledExecution(prepared));
	}
	async completeScheduledExecution(prepared) {
		switch (prepared.kind) {
			case "dispatch": {
				const dispatched = await this.dispatchScheduledExecution(prepared.exec);
				return dispatched.kind === "post-result" ? await this.finalizeScheduledExecution(prepared.exec, dispatched.result) : this.finishScheduledExecution(prepared.exec, dispatched.result);
			}
			case "post-result": return await this.finalizeScheduledExecution(prepared.exec, prepared.result);
			case "final-result": return this.finishScheduledExecution(prepared.exec, prepared.result);
			/* v8 ignore next -- closed-union exhaustiveness guard */
			default: return assertNever(prepared, "scheduled tool preparation");
		}
	}
	createExecution(exec) {
		const deferredContexts = [];
		const token = createExecutionToken();
		const callId = exec.callId;
		const rootCallId = exec.rootCallId ?? callId;
		const name = exec.name;
		const agent = exec.agent;
		const parent = exec.parent;
		const signal = exec.signal;
		const visible = this.get(name, agent);
		const collapsed = visible !== void 0 && this.collapses(name, agent, parent !== void 0);
		const concludingExecutions = this.concludingExecutions;
		const base = {
			token,
			callId,
			rootCallId,
			name,
			signal,
			...agent !== void 0 ? { agent } : {},
			...parent !== void 0 ? { parent } : {},
			deferContext(context) {
				deferredContexts.push(context);
			},
			concludeTurn() {
				concludingExecutions.add(this);
			}
		};
		const capturedFinalizer = visible?.finalizeContent?.bind(visible);
		const finalizerFor = () => collapsed && !signal.aborted ? void 0 : capturedFinalizer;
		try {
			const detached = snapshotJsonValue(exec.arguments);
			if (detached === void 0) throw new TypeError("tool execution arguments must be losslessly JSON-serializable");
			const execution = {
				...base,
				arguments: deepFreeze$1(detached)
			};
			this.deferredContexts.set(execution, deferredContexts);
			this.contentFinalizers.set(execution, finalizerFor());
			this.cancellationStates.set(execution, {
				callerSignal: signal,
				bodyInvoked: false
			});
			if (collapsed) {
				if (signal.aborted) return {
					kind: "final-result",
					exec: execution,
					result: toolAbortedBeforeDispatchResult()
				};
				return {
					kind: "final-result",
					exec: execution,
					result: toolErrorResult(new ToolNotFoundError(name, `only \`${RUN_CODE_NAME}\` is callable directly — call \`${name}\` from inside a \`${RUN_CODE_NAME}\` program instead`))
				};
			}
			return {
				kind: "ready",
				exec: execution
			};
		} catch (error) {
			const execution = {
				...base,
				arguments: void 0
			};
			this.contentFinalizers.set(execution, finalizerFor());
			return {
				kind: "final-result",
				exec: execution,
				result: toolErrorResult(error)
			};
		}
	}
	/**
	* Run the ordered pre-execute and monotonic guard stages for the scheduler.
	* @param input - the caller-supplied execution input.
	* @returns the prepared execution plus the next scheduler stage.
	* @internal
	*/
	async prepareScheduledExecution(input) {
		return this.prepareExecution(input, (prepared) => prepared);
	}
	async prepareExecution(input, next) {
		const created = this.createExecution(input);
		if (created.kind !== "ready") return next(created);
		const exec = created.exec;
		if (this.callerCancelled(exec)) return next({
			kind: "final-result",
			exec,
			result: toolAbortedBeforeDispatchResult()
		});
		try {
			const carrier = scopeTarget(this, exec.agent);
			const gate = await this.ctx.waterfall(carrier, "tools/pre-execute", exec, () => Promise.resolve({ kind: "allow" }));
			const askResolution = gate.kind === "ask" ? await this.serviceAsk(exec, gate) : {
				decision: gate,
				approvalCancelled: false
			};
			const { decision } = askResolution;
			if (this.callerCancelled(exec) && askResolution.approvalCancelled) return await next({
				kind: "post-result",
				exec,
				result: toolAbortedBeforeDispatchResult()
			});
			const denialReason = decision.kind === "allow" ? this.guardReason(exec) : decision.reason;
			if (denialReason !== void 0) return await next({
				kind: "post-result",
				exec,
				result: this.materializeFinalResult({
					content: [{
						type: "text",
						text: `Error: ${denialReason}`
					}],
					isError: true,
					error: { message: denialReason }
				})
			});
			if (this.callerCancelled(exec)) return await next({
				kind: "post-result",
				exec,
				result: toolAbortedBeforeDispatchResult()
			});
			return await next({
				kind: "dispatch",
				exec
			});
		} catch (error) {
			return next({
				kind: "final-result",
				exec,
				result: toolErrorResult(error)
			});
		}
	}
	/** Whether the original caller signal is currently aborted. */
	callerCancelled(exec) {
		const state = this.cancellationStates.get(exec);
		/* v8 ignore next -- only registry-minted executions reach the staged scheduler methods */
		if (state === void 0) throw new Error("tool registry scheduler invariant violated: missing cancellation state");
		return state.callerSignal.aborted;
	}
	/** Canonical cancellation outcome selected by whether the tool body started. */
	cancellationResult(exec, prior) {
		const state = this.cancellationStates.get(exec);
		/* v8 ignore next -- only registry-minted executions reach the staged scheduler methods */
		if (state === void 0) throw new Error("tool registry scheduler invariant violated: missing cancellation state");
		return state.bodyInvoked ? toolAbortedResult(prior) : toolAbortedBeforeDispatchResult(prior);
	}
	/**
	* Dispatch the registered body with the original caller signal fused back
	* into any around-wrapper replacement. Cancellation never abandons the body:
	* a started promise reaches quiescence before its outcome becomes `ABORTED`.
	*/
	async dispatchToolBody(exec) {
		const state = this.cancellationStates.get(exec);
		/* v8 ignore next -- only registry-minted executions reach the staged scheduler methods */
		if (state === void 0) throw new Error("tool registry scheduler invariant violated: missing cancellation state");
		const wrapperSignal = exec.signal;
		const fused = fuseToolSignals(state.callerSignal, wrapperSignal);
		const signal = fused.signal;
		if (isAborted(signal)) {
			fused.dispose();
			return toolAbortedBeforeDispatchResult();
		}
		exec.signal = signal;
		try {
			const tool = this.resolveExecution(exec.name, exec.agent, exec.parent !== void 0);
			if (!tool) throw new ToolNotFoundError(exec.name);
			state.bodyInvoked = true;
			const returned = await tool.execute(exec.arguments, exec);
			const result = this.createSuccessResult(exec, tool, returned);
			return isAborted(signal) ? toolAbortedResult(result) : result;
		} catch (error) {
			return toolErrorResult(error);
		} finally {
			fused.dispose();
			exec.signal = wrapperSignal;
		}
	}
	/**
	* Run around-dispatch and the tool body. Tool and unknown-tool failures still
	* receive post-execute; pipeline failures are already final.
	* @param exec - the prepared execution.
	* @returns whether the result still needs post-execute.
	* @internal
	*/
	async dispatchScheduledExecution(exec) {
		try {
			const mutableExec = exec;
			const carrier = scopeTarget(this, exec.agent);
			const result = await this.ctx.waterfall(carrier, "tools/execute", mutableExec, () => this.dispatchToolBody(mutableExec));
			const normalized = this.normalizeDispatchResult(exec, result);
			const deferredContexts = this.deferredContexts.get(exec);
			/* v8 ignore next -- dispatch only receives executions minted by this registry's prepare stage */
			if (deferredContexts === void 0) throw new Error("tool registry scheduler invariant violated: unprepared execution");
			const resultWithDeferredContexts = deferredContexts.length === 0 ? normalized : this.markCanonical(exec, {
				...normalized,
				additionalContexts: [...deferredContexts, ...normalized.additionalContexts ?? []]
			});
			return {
				kind: "post-result",
				result: this.callerCancelled(exec) && !resultWithDeferredContexts.isError ? this.cancellationResult(exec, resultWithDeferredContexts) : resultWithDeferredContexts
			};
		} catch (error) {
			return {
				kind: "final-result",
				result: toolErrorResult(error)
			};
		}
	}
	/**
	* Run ordered post-execute, then apply definition-owned content finalization,
	* materialize, and notify the final outcome.
	* @param exec - the prepared execution.
	* @param result - dispatch/pre result that still needs post-execute.
	* @returns the materialized final result.
	* @internal
	*/
	async finalizeScheduledExecution(exec, result) {
		try {
			const postResult = await this.postExecute(exec, result);
			return this.finishScheduledExecution(exec, this.callerCancelled(exec) && !postResult.isError ? this.cancellationResult(exec, postResult) : postResult);
		} catch (error) {
			return this.finishScheduledExecution(exec, toolErrorResult(error));
		}
	}
	/**
	* Materialize the candidate, apply definition-owned content finalization,
	* then materialize and notify the authoritative result.
	* @param exec - the prepared execution.
	* @param result - final result.
	* @returns the materialized final result.
	* @internal
	*/
	finishScheduledExecution(exec, result) {
		let materializedResult;
		try {
			materializedResult = this.materializeFinalResult(result);
		} catch (error) {
			materializedResult = this.materializeFinalResult(toolErrorResult(error));
		}
		let finalResult;
		try {
			finalResult = this.materializeFinalResult(this.applyFinalContent(exec, materializedResult));
		} catch (error) {
			finalResult = this.materializeFinalResult(toolErrorResult(error));
		}
		this.notifyResult(exec, finalResult);
		return finalResult;
	}
	/** Apply the snapshotted tool-owned content transform without exposing other result fields. */
	applyFinalContent(exec, result) {
		const finalizeContent = this.contentFinalizers.get(exec);
		if (finalizeContent === void 0) return result;
		const content = finalizeContent(exec, result);
		return content === void 0 ? result : {
			...result,
			content
		};
	}
	/** Notify observers without exposing a mutation or error channel into the outcome. */
	notifyResult(exec, result) {
		Object.freeze(exec);
		const { name: toolName, callId } = exec;
		const reportFailure = (error) => {
			this.ctx.logger.warn(`tool "${toolName}" (${callId}): tools/result observer failed: ${errorMessage(error)}`);
		};
		const callbacks = this.ctx.events.dispatch("emit", [
			scopeTarget(this, exec.agent),
			"tools/result",
			exec,
			result
		]);
		for (const callback of callbacks) try {
			const returned = callback(exec, result);
			Promise.resolve(returned).catch(reportFailure);
		} catch (error) {
			reportFailure(error);
		}
	}
	/**
	* Resolve an `ask` decision to allow/deny through the approval seam. The
	* seam is consumed opportunistically with `ctx.get('approval')` — a
	* deployment that composes no ApprovalService keeps the historical degrade
	* to deny, and an unmount mid-session degrades the same way on the next ask.
	* An agent-less execution also degrades: without an agent there is no
	* session to audit to and no UI to route to. Otherwise the outcome maps
	* one-to-one — `allowed-once` proceeds; the three non-grants deny with
	* distinct reasons so the model can tell a human "no" from an absent
	* approval channel.
	*/
	async serviceAsk(exec, ask) {
		const approval = this.ctx.get("approval");
		if (approval === void 0) return {
			decision: {
				kind: "deny",
				reason: ask.reason ?? `tool "${exec.name}" requires approval (not yet supported)`
			},
			approvalCancelled: false
		};
		if (exec.agent === void 0) return {
			decision: {
				kind: "deny",
				reason: `tool "${exec.name}" requires approval, but the call has no agent to route it through`
			},
			approvalCancelled: false
		};
		const outcome = await approval.request({
			agent: exec.agent,
			toolName: exec.name,
			callId: exec.callId,
			...ask.reason !== void 0 ? { reason: ask.reason } : {},
			signal: exec.signal
		});
		switch (outcome) {
			case "allowed-once": return {
				decision: { kind: "allow" },
				approvalCancelled: false
			};
			case "rejected": return {
				decision: {
					kind: "deny",
					reason: `the user rejected tool "${exec.name}"`
				},
				approvalCancelled: false
			};
			case "cancelled": return {
				decision: {
					kind: "deny",
					reason: `approval for tool "${exec.name}" was cancelled`
				},
				approvalCancelled: true
			};
			case "unavailable": return {
				decision: {
					kind: "deny",
					reason: `tool "${exec.name}" requires approval, but no approval channel is available`
				},
				approvalCancelled: false
			};
			default: return assertNever(outcome, "ApprovalOutcome");
		}
	}
	/**
	* Run the `tools/post-execute` waterfall over a dispatched `result` and apply
	* its {@link PostToolDecision}: `accept` keeps the call successful (replacing
	* `content` when given), `block` turns it into an `isError` whose content is
	* the corrective `feedback`. Either decision may attach `additionalContexts`,
	* which are ferried on the returned result for the loop's active-batch FIFO.
	* Context deferred by the tool body survives an accepted result but is
	* discarded when the outer call is blocked; a block exposes only context the
	* blocking decision explicitly supplied.
	* Runs inside `execute`'s outer try/catch (a throwing listener → isError).
	*/
	async postExecute(exec, result) {
		const decision = await this.ctx.waterfall(scopeTarget(this, exec.agent), "tools/post-execute", exec, result, () => Promise.resolve({ kind: "accept" }));
		const decisionContexts = decision.additionalContexts ?? [];
		if (decision.kind === "block") {
			const message = failureMessageFromContent(decision.feedback);
			return this.markCanonical(exec, {
				content: decision.feedback,
				isError: true,
				error: { message },
				...decisionContexts.length > 0 ? { additionalContexts: decisionContexts } : {}
			});
		}
		if (Object.hasOwn(decision, "content") && Object.hasOwn(decision, "value")) throw new TypeError("tools/post-execute accept decision cannot replace both value and content");
		const additionalContexts = [...result.additionalContexts ?? [], ...decisionContexts];
		if (Object.hasOwn(decision, "value")) {
			if (result.isError) throw new TypeError("tools/post-execute cannot replace the value of a failed result");
			const tool = this.resolveExecution(exec.name, exec.agent, exec.parent !== void 0);
			if (tool === void 0) throw new ToolNotFoundError(exec.name);
			const replaced = this.createSuccessResult(exec, tool, decision.value);
			return this.markCanonical(exec, {
				...replaced,
				...additionalContexts.length > 0 ? { additionalContexts } : {}
			});
		}
		return this.markCanonical(exec, {
			...result,
			...decision.content !== void 0 ? { content: decision.content } : {},
			...additionalContexts.length > 0 ? { additionalContexts } : {}
		});
	}
	/** Registry-normalized results and the exact dispatch that validated each value. */
	canonicalResults = /* @__PURE__ */ new WeakMap();
	/** Mark one registry-normalized result as canonical only for its owning dispatch. */
	markCanonical(exec, result) {
		this.canonicalResults.set(result, exec.token);
		return result;
	}
	/** Snapshot, validate, render, and optionally project one successful body value. */
	createSuccessResult(exec, tool, candidate) {
		const detached = snapshotToolValue(tool.name, candidate);
		const violations = validateJsonSchemaValue(tool.output.schema, detached, "value");
		if (violations.length > 0) throw new ToolOutputError(tool.name, violations);
		const value = deepFreeze$1(detached);
		let rendered;
		try {
			rendered = tool.output.render(exec.arguments, value);
		} catch (error) {
			throw projectionError(tool.name, "render", error);
		}
		const content = snapshotProjection(tool.name, "render", rendered);
		let meta;
		if (exec.parent === void 0 && tool.output.presentationMeta !== void 0) {
			let projected;
			try {
				projected = tool.output.presentationMeta(exec.arguments, value);
			} catch (error) {
				throw projectionError(tool.name, "presentationMeta", error);
			}
			meta = snapshotProjection(tool.name, "presentationMeta", projected);
		}
		const concludesTurn = this.concludingExecutions.has(exec);
		return this.markCanonical(exec, this.materializeFinalResult({
			isError: false,
			value,
			content,
			...meta !== void 0 ? { meta } : {},
			...concludesTurn ? { concludesTurn: true } : {}
		}));
	}
	/** Normalize an around-dispatch wrapper's authored result through the owning output contract. */
	normalizeDispatchResult(exec, result) {
		if (this.canonicalResults.get(result) === exec.token) return result;
		if (result.isError) return this.markCanonical(exec, {
			isError: true,
			error: result.error,
			content: result.content,
			...result.meta !== void 0 ? { meta: result.meta } : {},
			...result.additionalContexts !== void 0 ? { additionalContexts: result.additionalContexts } : {}
		});
		const tool = this.resolveExecution(exec.name, exec.agent, exec.parent !== void 0);
		if (tool === void 0) throw new ToolNotFoundError(exec.name);
		const normalized = this.createSuccessResult(exec, tool, result.value);
		return this.markCanonical(exec, {
			...normalized,
			...result.additionalContexts !== void 0 ? { additionalContexts: result.additionalContexts } : {}
		});
	}
	/** Materialize the authoritative commit outcome once, immediately before `tools/result`. */
	materializeFinalResult(result) {
		const presentation = {
			content: result.content,
			...result.meta !== void 0 ? { meta: result.meta } : {},
			...result.additionalContexts !== void 0 ? { additionalContexts: result.additionalContexts } : {}
		};
		if (result.isError) return materializePresentation({
			isError: true,
			error: result.error,
			...presentation
		});
		return deepFreeze$1({
			...materializePresentation({
				isError: false,
				...presentation,
				...result.concludesTurn === true ? { concludesTurn: true } : {}
			}),
			value: result.value
		});
	}
});
/** Mint a same-process correlation token whose identity is its value. */
function createExecutionToken() {
	return Symbol("dsh.tool.execution");
}
function toolErrorResult(error) {
	const info = errorInfo(error);
	const message = errorMessage(error);
	return {
		content: [{
			type: "text",
			text: `Error: ${message}`
		}],
		isError: true,
		error: {
			message,
			...info ? { info } : {}
		}
	};
}
/** Read live abort state across an await without treating it as synchronously immutable. */
function isAborted(signal) {
	return signal.aborted;
}
/**
* Fuse caller and wrapper cancellation without nesting `AbortSignal.any`.
* Keeping the relay dispatch-scoped also removes listeners when work settles.
*/
function fuseToolSignals(caller, wrapper) {
	if (caller === wrapper) return {
		signal: caller,
		dispose() {}
	};
	const controller = new AbortController();
	let listening = false;
	const dispose = () => {
		if (!listening) return;
		listening = false;
		caller.removeEventListener("abort", abortFromCaller);
		wrapper.removeEventListener("abort", abortFromWrapper);
	};
	const abortFrom = (source) => {
		const reason = source.reason;
		controller.abort(reason);
		dispose();
	};
	const abortFromCaller = () => {
		abortFrom(caller);
	};
	const abortFromWrapper = () => {
		abortFrom(wrapper);
	};
	if (wrapper.aborted) abortFromWrapper();
	else if (caller.aborted) abortFromCaller();
	else {
		listening = true;
		caller.addEventListener("abort", abortFromCaller, { once: true });
		wrapper.addEventListener("abort", abortFromWrapper, { once: true });
	}
	return {
		signal: controller.signal,
		dispose
	};
}
/** Canonical result when cancellation supersedes success after body invocation. */
function toolAbortedResult(prior) {
	const additionalContexts = prior?.additionalContexts ?? [];
	return {
		content: [{
			type: "text",
			text: "Error: tool call aborted"
		}],
		isError: true,
		error: {
			message: "tool call aborted",
			info: {
				name: "AbortError",
				code: TOOL_ABORTED
			}
		},
		...additionalContexts.length > 0 ? { additionalContexts } : {}
	};
}
/** Canonical result when cancellation prevents tool body invocation. */
function toolAbortedBeforeDispatchResult(prior) {
	const additionalContexts = prior?.additionalContexts ?? [];
	return {
		content: [{
			type: "text",
			text: "Error: tool call aborted before dispatch"
		}],
		isError: true,
		error: {
			message: "tool call aborted before dispatch",
			info: {
				name: "AbortError",
				code: TOOL_ABORTED_BEFORE_DISPATCH
			}
		},
		...additionalContexts.length > 0 ? { additionalContexts } : {}
	};
}
//#endregion
//#region ../../deepseek-harness/packages/credentials/credentials/lib/index.js
/**
* Service Definition for the credential-reference capability seam (`ctx.credentials`). Settings and composition files carry
* *references* to secrets — environment-variable names — while providers own
* the actual values and their storage. Consumers resolve a reference once per
* operation, so a changed credential reaches the next operation without any
* plugin restart, and configuration surfaces describe a reference without
* ever seeing its value.
* @module @deepseek-ai/dsh-credentials
*/
const REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
/**
* Brand a raw string as a {@link CredentialRef}.
* @param value - candidate reference; a POSIX shell identifier such as `DEEPSEEK_API_KEY`.
* @returns the branded reference.
*/
function credentialRef(value) {
	if (!REF_PATTERN.test(value)) throw new TypeError(`credential ref "${value}" must match ${String(REF_PATTERN)}`);
	return value;
}
//#endregion
//#region ../../deepseek-harness/packages/settings/settings/lib/index.js
/**
* Structural secret redaction for settings values. `role('secret')` fields are
* removed from a value before it crosses a wire boundary; a sidecar records
* each schema-declared secret position and whether it currently holds a value,
* so a configuration surface can render a write-only input without ever
* receiving the secret itself.
* @module @deepseek-ai/dsh-settings/redact
*/
/** Whether a value is a plain data object the walker may recurse into. */
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function walk(node, value, path, secrets) {
	if (node === void 0) return value;
	if (node.meta?.role === "secret") {
		secrets.push({
			path,
			set: value !== void 0
		});
		return;
	}
	switch (node.type) {
		case "object": {
			const properties = node.dict ?? {};
			const source = isRecord(value) ? value : void 0;
			const rebuilt = {};
			if (source !== void 0) for (const [key, entry] of Object.entries(source)) {
				if (key in properties) continue;
				rebuilt[key] = entry;
			}
			for (const [key, child] of Object.entries(properties)) {
				const stripped = walk(child, source?.[key], [...path, key], secrets);
				if (stripped !== void 0) rebuilt[key] = stripped;
			}
			return source === void 0 && Object.keys(rebuilt).length === 0 ? value : rebuilt;
		}
		case "dict": {
			if (!isRecord(value)) return value;
			const rebuilt = {};
			for (const [key, entry] of Object.entries(value)) {
				const stripped = walk(node.inner, entry, [...path, key], secrets);
				if (stripped !== void 0) rebuilt[key] = stripped;
			}
			return rebuilt;
		}
		case "array":
			if (!Array.isArray(value)) return value;
			return value.map((entry, index) => walk(node.inner, entry, [...path, String(index)], secrets));
		default: return value;
	}
}
/**
* Service Definition for the user-settings capability seam (`ctx.settings`). Providers store one raw document of
* per-namespace sections; plugins register a namespace schema and read the
* resolved value, which layers schema defaults, the registrant's composition
* `base`, and the user document section, in that order.
* @module @deepseek-ai/dsh-settings
*/
const NAMESPACE_PATTERN = /^[a-z][a-z0-9-]*$/;
/**
* Brand a raw string as a {@link SettingsNamespace}.
* @param value - candidate namespace; lowercase kebab-case, as in plugin short names.
* @returns the branded namespace.
*/
function settingsNamespace(value) {
	if (!NAMESPACE_PATTERN.test(value)) throw new TypeError(`settings namespace "${value}" must match ${String(NAMESPACE_PATTERN)}`);
	return value;
}
/**
* Deep equality over JSON-compatible data (objects, arrays, primitives) — the
* Service Definition's single change-detection predicate, exported so the invariant
* companion checks exactly the implementation's relation.
* @param a - one JSON-compatible value.
* @param b - the other JSON-compatible value.
* @returns whether the two values are structurally equal.
*/
function deepEqualJson(a, b) {
	if (a === b) return true;
	if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
		return a.every((entry, index) => deepEqualJson(entry, b[index]));
	}
	const left = a;
	const right = b;
	const keys = Object.keys(left);
	if (keys.length !== Object.keys(right).length) return false;
	return keys.every((key) => key in right && deepEqualJson(left[key], right[key]));
}
/** Whether a value is a plain data object (not an array, null, or class instance). */
function isPlainObject(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}
/** Apply one path op to a detached section, returning the next section. */
function applyPathOp(section, op) {
	const [head, ...rest] = op.path;
	if (head === void 0) {
		if (op.op === "unset") return {};
		if (!isPlainObject(op.value)) throw new TypeError("settings mutate: setting the section root requires a plain object");
		return { ...op.value };
	}
	if (rest.length === 0) {
		if (op.op === "set") return {
			...section,
			[head]: op.value
		};
		const { [head]: _removed, ...kept } = section;
		return kept;
	}
	const child = section[head];
	if (!isPlainObject(child)) {
		if (op.op === "unset") return section;
		return {
			...section,
			[head]: applyPathOp({}, {
				...op,
				path: rest
			})
		};
	}
	return {
		...section,
		[head]: applyPathOp(child, {
			...op,
			path: rest
		})
	};
}
/**
* Layer `over` onto `under`: plain objects merge recursively, every other
* value (arrays included) replaces the lower layer wholesale. `over` never
* carries `undefined` entries — sections come from parsed documents and write
* snapshots pass {@link cloneJsonShaped}, which strips them so a sparse patch
* cannot erase lower keys.
*/
function mergeLayers(under, over) {
	if (over === void 0) return under;
	if (!isPlainObject(under) || !isPlainObject(over)) return over;
	const merged = { ...under };
	for (const [key, value] of Object.entries(over)) merged[key] = key in merged ? mergeLayers(merged[key], value) : value;
	return merged;
}
/** Recursively freeze one resolved value so handed-out snapshots stay immutable. */
function deepFreeze(value) {
	if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
	for (const entry of Object.values(value)) deepFreeze(entry);
	return Object.freeze(value);
}
Service.init;
/**
* Value mirror of the `FiberState` members {@link isUnloading} compares
* against: a const enum has no runtime object to import, and the value is
* needed at runtime (same rationale as the CLI boot driver's mirror).
*/
const FIBER_DISPOSED = 4;
const FIBER_UNLOADING = 5;
/** Whether the consumer's own fiber is tearing down (not just losing the settings service). */
function isUnloading(ctx) {
	const state = ctx.fiber.state;
	return state === FIBER_UNLOADING || state === FIBER_DISPOSED;
}
/**
* Install the canonical optional-settings consumer wiring: while a settings
* service exists, register `ns` with the consumer's composition entry as the
* `base` layer and point the source thunk at the resolved scope; when the
* service goes away (disposal, provider reload), fall back to the entry so
* the consumer keeps working exactly as composed. The registration rides the
* scoped fiber, so no settings service ever mounted means none of this runs.
* @param ctx - consumer plugin context owning the wiring.
* @param ns - the consumer-owned settings namespace.
* @param schema - schema resolving the namespace (typically the plugin Config).
* @param entry - the consumer's composition entry config, used as `base`.
* @param hooks - source sink and change notification.
*/
function installSettingsSection(ctx, ns, schema, entry, hooks) {
	ctx.inject(["settings"], (sctx) => {
		const scope = sctx.settings.register(ns, schema, {
			base: entry,
			...hooks.validate === void 0 ? {} : { validate: hooks.validate }
		});
		hooks.setSource(() => scope.get());
		sctx.effect(() => () => {
			if (isUnloading(ctx)) return;
			hooks.setSource(() => entry);
			hooks.onChange();
		});
		hooks.onChange();
		scope.watch(() => {
			if (isUnloading(ctx)) return;
			hooks.onChange();
		});
	});
}
//#endregion
//#region ../../deepseek-harness/packages/util/launch-environment/lib/index.js
/**
* Immutable launch-time environment snapshot that records which layer
* supplied each value. Harness consumers resolve through it instead of a flattened
* `process.env`; launchers may still materialize accepted values for config
* expressions and third-party libraries.
* @module @deepseek-ai/dsh-launch-environment
*/
/** Layer order, most trusted first. */
const SOURCE_ORDER = [
	"process",
	"project-env",
	"user-env"
];
/**
* The map key one variable name resolves under. Windows treats environment
* names case-insensitively; every other platform does not.
* @param name - the variable name as written.
* @returns the key to store and look up by.
*/
function lookupKey(name) {
	/* v8 ignore next -- native Windows coverage exercises the folding arm; POSIX covers the exact one */
	return process.platform === "win32" ? name.toUpperCase() : name;
}
/**
* Build the snapshot from each layer's contents.
* @param layers - the layers in any order; the result searches them by canonical trust order.
* @returns the immutable snapshot.
*/
function createLaunchEnvironmentSnapshot(layers) {
	const bySource = /* @__PURE__ */ new Map();
	for (const layer of layers) bySource.set(layer.source, {
		...layer.path === void 0 ? {} : { path: layer.path },
		values: new Map(Object.entries(layer.values).map(([name, value]) => [lookupKey(name), value]))
	});
	const getFrom = (name, sources) => {
		const key = lookupKey(name);
		for (const source of SOURCE_ORDER) {
			if (!sources.includes(source)) continue;
			const layer = bySource.get(source);
			const value = layer?.values.get(key);
			if (value === void 0) continue;
			return {
				value,
				source,
				...layer?.path === void 0 ? {} : { path: layer.path }
			};
		}
	};
	return {
		get: (name) => getFrom(name, SOURCE_ORDER),
		getFrom
	};
}
/**
* Return the launcher's snapshot, or the inherited environment as the sole
* layer when the host provided none.
* @param ctx - the consuming plugin's context.
* @returns the snapshot to resolve user-facing values against.
*/
function launchEnvironmentOf(ctx) {
	return ctx.get("launchEnvironment") ?? createLaunchEnvironmentSnapshot([{
		source: "process",
		values: process.env
	}]);
}
//#endregion
//#region src/zh-thinking.ts
/**
* webui — 中文思考开关（自 dsh-zh-thinking 合并）。
*
* - settings 命名空间 `zh-thinking` 持久化开关（enabled，默认 true）
* - systemPrompt section `zh-thinking`：按开关注入中文思考指令
* - HTTP API：GET /api/zh-thinking → { enabled }；POST { enabled } → 更新
*/
const INSTRUCTION = "重要:你的全部内部思考过程(reasoning/thinking)必须使用中文书写,与用户当前使用的语言保持一致。仅代码、标识符、文件名、专有名词、技术术语可以保留英文。";
function readBody$3(req) {
	return new Promise((resolve) => {
		let data = "";
		req.on("data", (chunk) => {
			data += chunk;
		});
		req.on("end", () => {
			try {
				resolve(JSON.parse(data || "{}"));
			} catch {
				resolve(null);
			}
		});
		req.on("error", () => resolve(null));
	});
}
/** 注册「中文思考」开关：settings 持久化 + 提示词注入 + HTTP API。 */
function applyZhThinking(ctx) {
	let scope;
	try {
		scope = ctx.settings.register("zh-thinking", Schema.object({ enabled: Schema.boolean().default(true) }));
	} catch (error) {
		console.log("[zh-thinking] settings namespace already registered:", error?.message ?? error);
	}
	const readEnabled = () => {
		if (scope !== void 0) try {
			return scope.get().enabled !== false;
		} catch {}
		return true;
	};
	ctx.effect(() => ctx.systemPrompt.section({
		name: "zh-thinking",
		order: -50,
		text: () => readEnabled() ? INSTRUCTION : ""
	}));
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: "/api/zh-thinking",
		handler: async (req, res) => {
			try {
				if (req.method === "POST") {
					const body = await readBody$3(req);
					if (body && typeof body.enabled === "boolean" && scope !== void 0) await scope.update({ enabled: body.enabled });
				}
				const payload = JSON.stringify({
					ok: true,
					enabled: readEnabled()
				});
				res.writeHead(200, {
					"content-type": "application/json",
					"cache-control": "no-store"
				});
				res.end(payload);
			} catch (error) {
				res.writeHead(500, { "content-type": "application/json" });
				res.end(JSON.stringify({
					ok: false,
					error: String(error?.message ?? error)
				}));
			}
		}
	}));
}
//#endregion
//#region src/task-done-sound.ts
/**
* webui — 任务完成提示音 + 对话完成桌面卡片（自 dsh-task-done-sound 合并）。
*
* - /dyn-assets/*.wav 前缀路由：从插件 assets 目录读取音频（新增提示音 =
*   往 assets 放一个 .wav 即可）。
* - POST /api/task-done-sound/conversation-done：客户端回合结束时调用，
*   启动 scripts/conversation-done-card.ps1（右下角卡片 + 提示音）。
*   提示音由 host 端 PowerShell 播放（SoundPlayer），绕开浏览器 autoplay 拦截。
*/
const PKG_DIR$1 = fileURLToPath(new URL("..", import.meta.url));
const CARD_SCRIPT = join(PKG_DIR$1, "scripts", "conversation-done-card.ps1");
function applyTaskDoneSound(ctx, config = {}) {
	const soundDir = config.soundDir || "D:\\AI\\Dsh\\assets";
	const shellDir = config.shellDir || "D:\\AI\\Dsh";
	const extraFallbacks = { "task-done.wav": ["C:\\Users\\Anti\\.hanako\\plugins\\voice-announcer\\assets\\task-done.wav"] };
	const cache = /* @__PURE__ */ new Map();
	function loadAsset(name) {
		if (cache.has(name)) return cache.get(name) ?? null;
		const path = findAssetPath(name);
		const bytes = path === null ? null : readFileSync(path);
		cache.set(name, bytes);
		return bytes;
	}
	function findAssetPath(name) {
		const sources = [
			join(PKG_DIR$1, "assets", name),
			join(soundDir, name),
			...extraFallbacks[name] || []
		];
		for (const path of sources) try {
			if (existsSync(path) && statSync(path).size > 0) return path;
		} catch (error) {
			console.error(`[dsh-task-done-sound] stat failed at ${path}:`, error);
		}
		return null;
	}
	function findShellExe() {
		try {
			const distDir = join(shellDir, "dist");
			if (!existsSync(distDir)) return null;
			const exes = readdirSync(distDir).filter((f) => f.toLowerCase().endsWith(".exe"));
			if (exes.length === 0) return null;
			exes.sort((a, b) => statSync(join(distDir, b)).mtimeMs - statSync(join(distDir, a)).mtimeMs);
			return join(distDir, exes[0]);
		} catch (error) {
			console.error("[dsh-task-done-sound] findShellExe failed:", error);
			return null;
		}
	}
	function appendCardLog(line) {
		try {
			appendFileSync(join(shellDir, "conversation-card.log"), `[${(/* @__PURE__ */ new Date()).toISOString()}] ${line}\n`);
		} catch {}
	}
	function spawnCard({ sound = true, sessionLabel = "", sessionId = null } = {}) {
		try {
			if (!existsSync(CARD_SCRIPT)) {
				console.error("[dsh-task-done-sound] card script missing:", CARD_SCRIPT);
				appendCardLog(`host ERROR: card script missing: ${CARD_SCRIPT}`);
				return;
			}
			const exePath = findShellExe();
			const title = exePath === null ? "DeepSeek-Harness" : basename(exePath, ".exe");
			const soundPath = sound ? findAssetPath("task-done.wav") : null;
			const iconPath = join(shellDir, "assets", "app-icon.png");
			const args = [
				"-NoProfile",
				"-ExecutionPolicy",
				"Bypass",
				"-STA",
				"-File",
				CARD_SCRIPT,
				"-ExePath",
				exePath ?? "",
				"-Title",
				title,
				"-Message",
				"对话完成了"
			];
			if (sessionLabel !== "") args.push("-SessionLabel", sessionLabel);
			if (existsSync(iconPath)) args.push("-IconPath", iconPath);
			if (soundPath !== null) args.push("-SoundPath", soundPath);
			const child = spawn("powershell.exe", args, {
				stdio: "ignore",
				windowsHide: true
			});
			child.on("error", (err) => {
				console.error("[dsh-task-done-sound] spawn powershell errored:", err);
				appendCardLog(`host ERROR: spawn powershell errored: ${err.message}`);
			});
			child.unref();
			console.log(`[dsh-task-done-sound] conversation-done card spawned (exe=${exePath}, sound=${soundPath ?? "off"}, session=${sessionLabel !== "" ? sessionLabel : sessionId ?? "unknown"})`);
		} catch (error) {
			console.error("[dsh-task-done-sound] spawn card failed:", error);
			appendCardLog(`host ERROR: spawn card failed: ${String(error?.message ?? error)}`);
		}
	}
	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: "/dyn-assets",
		handler: async (req, res) => {
			const name = new URL(req.url ?? "/", "http://x").pathname.slice(12);
			if (name === "" || name.includes("/") || name.includes("\\") || !/^[A-Za-z0-9._-]+\.wav$/.test(name)) {
				res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
				res.end("not found");
				return;
			}
			const bytes = loadAsset(name);
			if (bytes === null) {
				res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
				res.end("not found");
				return;
			}
			res.writeHead(200, {
				"Content-Type": "audio/wav",
				"Content-Length": String(bytes.length),
				"Cache-Control": "no-store"
			});
			res.end(bytes);
		}
	}), "webui: task-done-sound wav prefix route");
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: "/api/task-done-sound/conversation-done",
		handler: async (req, res) => {
			if (req.method !== "POST") {
				res.writeHead(405, { "Content-Type": "application/json; charset=utf-8" });
				res.end(JSON.stringify({
					ok: false,
					message: "method not allowed"
				}));
				return;
			}
			let sound = true;
			let sessionId = null;
			let sessionTitle = "";
			try {
				const chunks = [];
				for await (const chunk of req) chunks.push(chunk);
				if (chunks.length > 0) {
					const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
					if (parsed && typeof parsed.sound === "boolean") sound = parsed.sound;
					if (parsed && typeof parsed.sessionId === "string" && parsed.sessionId !== "") sessionId = parsed.sessionId;
					if (parsed && typeof parsed.title === "string" && parsed.title !== "") sessionTitle = parsed.title;
				}
			} catch (error) {}
			if (config.cardEnabled !== false) spawnCard({
				sound,
				sessionLabel: sessionTitle,
				sessionId
			});
			res.writeHead(200, {
				"Content-Type": "application/json; charset=utf-8",
				"Cache-Control": "no-store"
			});
			res.end(JSON.stringify({
				ok: true,
				sound
			}));
		}
	}), "webui: task-done-sound conversation-done route");
	console.log(`[dsh-task-done-sound] mounted: /dyn-assets/*.wav, /api/task-done-sound/conversation-done (shellDir=${shellDir})`);
}
//#endregion
//#region src/updater.ts
/**
* webui — DSH 壳管理与一键更新（自 dsh-updater 合并）。
*
* HTTP API：/api/dsh-updater/state | check | start | autoStart
* - state：当前/远程版本、busy、上次更新结果、日志尾部、开机自启状态
* - check：git fetch + 比较本地/远程版本（服务存活期间执行）
* - start：写运行配置，分离式启动 updater.ps1（git pull → pnpm install → build → 重启壳子）
* - autoStart：读写 HKCU Run 键（开机自动运行壳子 exe）
* 附带：抑制 Web UI 原生右键菜单（壳子右键菜单成为唯一入口）。
*/
const PKG_DIR = fileURLToPath(new URL("..", import.meta.url));
const RUN_DIR = join(process.env.DSH_HOME || join(homedir(), ".dsh"), "dsh-updater");
const LOG_FILE = join(RUN_DIR, "update.log");
const RESULT_FILE = join(RUN_DIR, "last-result.json");
const PROGRESS_FILE = join(RUN_DIR, "progress.json");
const CONFIG_FILE = join(RUN_DIR, "run-config.json");
const SCRIPT_FILE = join(PKG_DIR, "assets", "updater.ps1");
const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const RUN_VALUE = "DeepSeekHarnessShell";
function runCmd(bin, args, cwd, timeoutMs = 12e4) {
	return new Promise((resolve) => {
		execFile(bin, args, {
			cwd,
			env: process.env,
			timeout: timeoutMs,
			maxBuffer: 8 * 1024 * 1024,
			windowsHide: true
		}, (err, stdout, stderr) => {
			if (err) resolve({
				ok: false,
				code: err.code ?? "error",
				stdout: String(stdout ?? ""),
				stderr: String(stderr ?? err.message)
			});
			else resolve({
				ok: true,
				code: 0,
				stdout: String(stdout),
				stderr: String(stderr)
			});
		});
	});
}
function git(gitBin, args, cwd, timeoutMs) {
	return runCmd(gitBin, args, cwd, timeoutMs);
}
function logTail() {
	try {
		if (!existsSync(LOG_FILE)) return null;
		return readFileSync(LOG_FILE, "utf8").split(/\r?\n/).filter(Boolean).slice(-50).join("\n");
	} catch {
		return null;
	}
}
function readResult() {
	try {
		if (!existsSync(RESULT_FILE)) return null;
		return JSON.parse(readFileSync(RESULT_FILE, "utf8"));
	} catch {
		return null;
	}
}
function readProgress() {
	try {
		if (!existsSync(PROGRESS_FILE)) return null;
		return JSON.parse(readFileSync(PROGRESS_FILE, "utf8"));
	} catch {
		return null;
	}
}
function readBody$2(req) {
	return new Promise((resolve) => {
		let data = "";
		req.on("data", (chunk) => {
			data += chunk;
			if (data.length > 65536) {
				req.destroy();
				resolve(null);
			}
		});
		req.on("end", () => {
			try {
				resolve(JSON.parse(data || "{}"));
			} catch {
				resolve(null);
			}
		});
		req.on("error", () => resolve(null));
	});
}
function applyUpdater(ctx, config = {}) {
	const dshDir = config.dshDir || process.cwd();
	const shellDir = config.shellDir || "D:\\AI\\Dsh";
	const gitBin = config.gitPath || "git";
	const state = {
		busy: null,
		current: null,
		remote: null,
		error: null
	};
	function findShellExe() {
		try {
			const distDir = join(shellDir, "dist");
			const exes = readdirSync(distDir).filter((f) => f.toLowerCase().endsWith(".exe"));
			if (exes.length === 0) return null;
			exes.sort((a, b) => statSync(join(distDir, b)).mtimeMs - statSync(join(distDir, a)).mtimeMs);
			return join(distDir, exes[0]);
		} catch {
			return null;
		}
	}
	async function getAutoStart() {
		const exePath = findShellExe();
		const q = await runCmd("reg.exe", [
			"query",
			RUN_KEY,
			"/v",
			RUN_VALUE
		], process.cwd(), 1e4);
		let enabled = false;
		if (q.ok && /DeepSeekHarnessShell/.test(q.stdout)) {
			const m = q.stdout.match(/REG_SZ\s+(\S.*)$/m);
			enabled = !!(exePath && m && m[1].trim().replace(/^"|"$/g, "").toLowerCase() === exePath.toLowerCase());
		}
		return {
			enabled,
			exePath
		};
	}
	async function setAutoStart(enabled) {
		const exePath = findShellExe();
		if (!exePath) return {
			ok: false,
			message: `未找到壳子 exe（${join(shellDir, "dist")} 目录下没有 .exe），请先打包壳子`
		};
		if (enabled) {
			const r = await runCmd("reg.exe", [
				"add",
				RUN_KEY,
				"/v",
				RUN_VALUE,
				"/t",
				"REG_SZ",
				"/d",
				exePath,
				"/f"
			], process.cwd(), 1e4);
			return r.ok ? {
				ok: true,
				exePath
			} : {
				ok: false,
				message: `写入注册表失败: ${(r.stderr || "").slice(0, 200)}`
			};
		}
		const r = await runCmd("reg.exe", [
			"delete",
			RUN_KEY,
			"/v",
			RUN_VALUE,
			"/f"
		], process.cwd(), 1e4);
		return r.ok ? {
			ok: true,
			exePath
		} : {
			ok: false,
			message: `删除注册表失败: ${(r.stderr || "").slice(0, 200)}`
		};
	}
	async function checkUpdate() {
		if (state.busy) return {
			ok: false,
			message: "已有任务在进行中"
		};
		state.busy = "checking";
		state.error = null;
		try {
			const branchRes = await git(gitBin, [
				"rev-parse",
				"--abbrev-ref",
				"HEAD"
			], dshDir, 15e3);
			const branch = branchRes.ok ? branchRes.stdout.trim() : "master";
			const headRes = await git(gitBin, ["rev-parse", "HEAD"], dshDir, 15e3);
			if (!headRes.ok) {
				state.error = `git rev-parse HEAD 失败: ${headRes.stderr.slice(0, 300)}`;
				return {
					ok: false,
					message: state.error
				};
			}
			const full = headRes.stdout.trim();
			const dateRes = await git(gitBin, [
				"log",
				"-1",
				"--format=%cd",
				"--date=short"
			], dshDir, 15e3);
			const date = dateRes.ok ? dateRes.stdout.trim() : "";
			const dirtyRes = await git(gitBin, ["status", "--porcelain"], dshDir, 15e3);
			const dirty = dirtyRes.ok ? dirtyRes.stdout.split(/\r?\n/).filter(Boolean).length : 0;
			state.current = {
				full,
				short: full.slice(0, 7),
				date,
				branch,
				dirty
			};
			const fetchRes = await git(gitBin, ["fetch", "origin"], dshDir, 18e4);
			if (!fetchRes.ok) {
				state.error = `git fetch 失败: ${fetchRes.stderr.slice(0, 400)}`;
				return {
					ok: false,
					message: state.error
				};
			}
			const remoteRef = `origin/${branch}`;
			const remoteRes = await git(gitBin, ["rev-parse", remoteRef], dshDir, 15e3);
			if (!remoteRes.ok) {
				state.error = `无法解析远程分支 ${remoteRef}（本地可能没有该分支的跟踪）`;
				state.remote = null;
				return {
					ok: false,
					message: state.error
				};
			}
			const remoteFull = remoteRes.stdout.trim();
			const aheadRes = await git(gitBin, [
				"rev-list",
				"--count",
				`${full}..${remoteRef}`
			], dshDir, 15e3);
			const ahead = aheadRes.ok ? Number(aheadRes.stdout.trim() || 0) : 0;
			state.remote = {
				full: remoteFull,
				short: remoteFull.slice(0, 7),
				ahead,
				hasUpdate: remoteFull !== full
			};
			return { ok: true };
		} catch (err) {
			state.error = String(err?.message ?? err);
			return {
				ok: false,
				message: state.error
			};
		} finally {
			state.busy = null;
		}
	}
	async function startUpdate() {
		if (state.busy) return {
			ok: false,
			message: "已有任务在进行中"
		};
		if (!state.current || !state.remote) {
			const checked = await checkUpdate();
			if (!checked.ok) return checked;
		}
		if (!state.remote.hasUpdate) return {
			ok: false,
			message: "已是最新版本，无需更新"
		};
		try {
			mkdirSync(RUN_DIR, { recursive: true });
			writeFileSync(CONFIG_FILE, JSON.stringify({
				dshDir,
				shellDir,
				logFile: LOG_FILE,
				resultFile: RESULT_FILE,
				progressFile: PROGRESS_FILE
			}, null, 2), "utf8");
			try {
				writeFileSync(PROGRESS_FILE, JSON.stringify({
					stage: "queued",
					percent: 0,
					msg: "更新任务已排队，脚本即将启动"
				}), "utf8");
			} catch {}
			spawn("powershell.exe", [
				"-NoProfile",
				"-ExecutionPolicy",
				"Bypass",
				"-File",
				SCRIPT_FILE,
				"-ConfigFile",
				CONFIG_FILE
			], {
				detached: true,
				stdio: "ignore",
				windowsHide: true
			}).unref();
			state.busy = "updating";
			return {
				ok: true,
				message: "更新已启动，服务即将重启"
			};
		} catch (err) {
			state.busy = null;
			return {
				ok: false,
				message: `启动更新失败: ${String(err?.message ?? err)}`
			};
		}
	}
	const handlers = {
		"/api/dsh-updater/state": async () => ({
			ok: true,
			busy: state.busy,
			dshDir,
			shellDir,
			current: state.current,
			remote: state.remote,
			error: state.error,
			lastResult: readResult(),
			progress: readProgress(),
			logTail: logTail(),
			autoStart: await getAutoStart()
		}),
		"/api/dsh-updater/check": async (req) => {
			if (req.method !== "POST") return null;
			return checkUpdate();
		},
		"/api/dsh-updater/start": async (req) => {
			if (req.method !== "POST") return null;
			return startUpdate();
		},
		"/api/dsh-updater/autoStart": async (req) => {
			if (req.method !== "POST") return null;
			const body = await readBody$2(req);
			if (!body || typeof body.enabled !== "boolean") return {
				ok: false,
				message: "参数错误：需要 JSON body {\"enabled\": boolean}"
			};
			return setAutoStart(body.enabled);
		}
	};
	for (const [path, fn] of Object.entries(handlers)) ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path,
		handler: async (req, res) => {
			try {
				const body = await fn(req);
				if (body === null) {
					res.writeHead(405, { "content-type": "application/json; charset=utf-8" });
					res.end(JSON.stringify({
						ok: false,
						message: "method not allowed"
					}));
					return;
				}
				const payload = JSON.stringify(body);
				res.writeHead(200, {
					"content-type": "application/json; charset=utf-8",
					"cache-control": "no-store"
				});
				res.end(payload);
			} catch (err) {
				res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
				res.end(JSON.stringify({
					ok: false,
					message: String(err?.message ?? err)
				}));
			}
		}
	}), `webui: updater ${path}`);
	console.log(`[dsh-updater] mounted dshDir=${dshDir} shellDir=${shellDir} script=${SCRIPT_FILE}`);
	ctx.effect(() => ctx.webServer.tapIndex((html) => {
		const tag = "<script>document.addEventListener(\"contextmenu\",function(e){var t=e.target;if(t&&(t.tagName===\"INPUT\"||t.tagName===\"TEXTAREA\"||t.isContentEditable))return;e.preventDefault()},true)<\/script>";
		const headEnd = html.indexOf("</head>");
		return headEnd === -1 ? tag + html : html.slice(0, headEnd) + tag + html.slice(headEnd);
	}), "webui: updater suppress native context menu");
}
//#endregion
//#region src/proxy.ts
/**
* webui — DSH 网络代理（自 dsh-proxy 合并）。
*
* 基于 undici ProxyAgent 做进程内代理（运行时生效，无需重启）：
* - all 模式：全部请求走代理（兼做兜底）
* - selected 模式：仅选中的厂商/域名走代理，其余直连
* settings 命名空间 `network-proxy` 持久化；HTTP API：
*   GET  /api/dsh-proxy/state | providers
*   POST /api/dsh-proxy/set   （立即应用或解除）
* 机制：包装 globalThis.fetch 按目标 host 注入 dispatcher；selected 清掉全局
* dispatcher，all 才挂 Symbol.for('undici.globalDispatcher.1') 兜底。
*/
const nodeRequire = createRequire(import.meta.url);
const DISPATCHER_SYMBOL = Symbol.for("undici.globalDispatcher.1");
const ORIGINAL_FETCH = Symbol.for("dsh-proxy.originalFetch");
const DEFAULT_PROXY = "http://127.0.0.1:10808";
let proxyState = null;
function loadUndici() {
	const candidates = [];
	try {
		candidates.push(new URL("../../node_modules/undici/package.json", import.meta.url).href);
	} catch {}
	candidates.push("D:/AI/deepseek-harness/node_modules/undici/package.json");
	const storeBase = "D:/AI/deepseek-harness/node_modules/.pnpm";
	try {
		const { readdirSync } = nodeRequire("node:fs");
		const { join } = nodeRequire("node:path");
		const dirs = readdirSync(storeBase).filter((d) => d.startsWith("undici@") && !d.includes("undici-types"));
		dirs.sort((a, b) => {
			const va = a.match(/undici@(.+)/)?.[1] ?? "";
			return (b.match(/undici@(.+)/)?.[1] ?? "").localeCompare(va, void 0, { numeric: true });
		});
		for (const d of dirs) candidates.push(join(storeBase, d, "node_modules", "undici", "package.json"));
	} catch {}
	for (const target of candidates) try {
		const ud = createRequire(target)("undici");
		if (ud && typeof ud.ProxyAgent === "function") return ud;
	} catch (err) {
		console.log(`[dsh-proxy] undici load from ${String(target)} failed: ${err?.message ?? err}`);
	}
	return null;
}
function installFetchHook() {
	const g = globalThis;
	if (g[ORIGINAL_FETCH] && typeof g[ORIGINAL_FETCH] === "function") return;
	const original = globalThis.fetch.bind(globalThis);
	Object.defineProperty(globalThis, ORIGINAL_FETCH, {
		value: original,
		configurable: true
	});
	globalThis.fetch = function(input, init) {
		const state = proxyState;
		if (state === null || !state.agent) return original(input, init);
		let viaProxy = state.mode === "all";
		if (!viaProxy && state.hosts && state.hosts.size > 0) {
			const host = hostnameOf(input);
			viaProxy = host !== null && matchHost(host, state.hosts);
		}
		if (!viaProxy) return original(input, init);
		const next = init === void 0 || init === null ? {} : { ...init };
		next.dispatcher = state.agent;
		return original(input, next);
	};
}
/** 从 fetch 入参提取 hostname（小写）；解析失败返回 null（不代理）。 */
function hostnameOf(input) {
	try {
		const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input && typeof input === "object" && "url" in input ? String(input.url) : "";
		return new URL(raw).hostname.toLowerCase();
	} catch {
		return null;
	}
}
/** 命中判定：精确 host 或 `*.domain` 模式（含子域）。 */
function matchHost(host, hosts) {
	if (hosts.has(host)) return true;
	for (const pattern of hosts) {
		if (typeof pattern !== "string") continue;
		if (pattern.startsWith("*.")) {
			const suffix = pattern.slice(1);
			if (host.endsWith(suffix)) return true;
		}
	}
	return false;
}
function applyProxy(ctx) {
	let scope;
	try {
		scope = ctx.settings.register("network-proxy", Schema.object({
			enabled: Schema.boolean().default(false),
			url: Schema.string().default(DEFAULT_PROXY),
			mode: Schema.union([Schema.const("all"), Schema.const("selected")]).default("all"),
			providers: Schema.array(Schema.string()).default([])
		}));
	} catch (error) {
		console.log("[dsh-proxy] settings namespace already registered:", error?.message ?? error);
	}
	const readConfig = () => {
		if (scope !== void 0) try {
			const v = scope.get();
			return {
				enabled: v.enabled !== false,
				url: v.url && v.url.trim() || DEFAULT_PROXY,
				mode: v.mode === "selected" ? "selected" : "all",
				providers: Array.isArray(v.providers) ? v.providers.filter((p) => typeof p === "string") : []
			};
		} catch {}
		return {
			enabled: false,
			url: DEFAULT_PROXY,
			mode: "all",
			providers: []
		};
	};
	const readProviders = () => {
		const out = [];
		try {
			const ns = ctx.settings.get("llm-pi-ai");
			const providers = ns && typeof ns === "object" && ns.providers && typeof ns.providers === "object" ? ns.providers : {};
			for (const [key, p] of Object.entries(providers)) {
				if (!p || typeof p !== "object") continue;
				const record = p;
				const baseURL = typeof record.baseURL === "string" ? record.baseURL : "";
				let host = null;
				try {
					host = new URL(baseURL).hostname;
				} catch {}
				out.push({
					key,
					name: typeof record.displayName === "string" && record.displayName.trim() || key,
					baseURL,
					host,
					api: typeof record.api === "string" ? record.api : ""
				});
			}
		} catch (error) {
			console.log("[dsh-proxy] readProviders failed:", error?.message ?? error);
		}
		return out;
	};
	/** 选中的厂商 route key -> 去重后的 hostname 集合。 */
	const selectedHosts = (cfg) => {
		const hosts = /* @__PURE__ */ new Set();
		if (Array.isArray(cfg.providers)) {
			const byKey = new Map(readProviders().map((p) => [p.key, p]));
			for (const key of cfg.providers) {
				const p = byKey.get(key);
				if (p && p.host) hosts.add(p.host);
			}
		}
		return hosts;
	};
	const isActive = () => {
		try {
			return proxyState !== null && !!(proxyState.agent && proxyState.agent.constructor && proxyState.agent.constructor.name === "ProxyAgent");
		} catch {
			return false;
		}
	};
	function applyProxy(cfg) {
		const undici = loadUndici();
		if (!undici) return {
			ok: false,
			message: "无法加载 undici"
		};
		const agent = new undici.ProxyAgent(cfg.url);
		proxyState = {
			agent,
			mode: cfg.mode,
			hosts: selectedHosts(cfg)
		};
		const g = globalThis;
		if (cfg.mode === "all") g[DISPATCHER_SYMBOL] = agent;
		else try {
			delete g[DISPATCHER_SYMBOL];
		} catch {}
		return { ok: true };
	}
	function clearProxy() {
		const g = globalThis;
		try {
			delete g[DISPATCHER_SYMBOL];
		} catch {}
		proxyState = null;
	}
	installFetchHook();
	try {
		const cfg = readConfig();
		if (cfg.enabled) {
			const r = applyProxy(cfg);
			console.log(`[dsh-proxy] boot: proxy ${r.ok ? "enabled" : "FAILED"} url=${cfg.url} mode=${cfg.mode} hosts=${[...selectedHosts(cfg)].join(",")}`);
		} else console.log("[dsh-proxy] boot: proxy disabled");
	} catch (err) {
		console.log("[dsh-proxy] boot apply failed:", err?.message ?? err);
	}
	function readBody(req) {
		return new Promise((resolve) => {
			let data = "";
			req.on("data", (chunk) => {
				data += chunk;
			});
			req.on("end", () => {
				try {
					resolve(JSON.parse(data || "{}"));
				} catch {
					resolve(null);
				}
			});
			req.on("error", () => resolve(null));
		});
	}
	function writeJson(res, obj) {
		res.writeHead(200, {
			"content-type": "application/json",
			"cache-control": "no-store"
		});
		res.end(JSON.stringify(obj));
	}
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: "/api/dsh-proxy/state",
		handler: async (_req, res) => {
			try {
				const cfg = readConfig();
				writeJson(res, {
					ok: true,
					...cfg,
					hosts: [...selectedHosts(cfg)],
					active: isActive()
				});
			} catch (error) {
				writeJson(res, {
					ok: false,
					error: String(error?.message ?? error)
				});
			}
		}
	}), "webui: dsh-proxy state");
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: "/api/dsh-proxy/providers",
		handler: async (_req, res) => {
			try {
				writeJson(res, {
					ok: true,
					providers: readProviders()
				});
			} catch (error) {
				writeJson(res, {
					ok: false,
					error: String(error?.message ?? error)
				});
			}
		}
	}), "webui: dsh-proxy providers");
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: "/api/dsh-proxy/set",
		handler: async (req, res) => {
			try {
				if (req.method !== "POST") {
					res.writeHead(405, { "content-type": "application/json" });
					res.end(JSON.stringify({
						ok: false,
						message: "method not allowed"
					}));
					return;
				}
				const body = await readBody(req);
				if (!body || typeof body !== "object") {
					writeJson(res, {
						ok: false,
						message: "参数错误"
					});
					return;
				}
				const current = readConfig();
				const enabled = typeof body.enabled === "boolean" ? body.enabled : current.enabled;
				const url = typeof body.url === "string" ? body.url.trim() : current.url;
				const mode = body.mode === "selected" ? "selected" : body.mode === "all" ? "all" : current.mode;
				const providers = Array.isArray(body.providers) ? body.providers.filter((p) => typeof p === "string") : current.providers;
				if (enabled && !/^https?:\/\/.+/.test(url)) {
					writeJson(res, {
						ok: false,
						message: "代理地址需为 http:// 或 https:// 开头"
					});
					return;
				}
				if (enabled) {
					const r = applyProxy({
						enabled,
						url,
						mode,
						providers
					});
					if (!r.ok) {
						writeJson(res, {
							ok: false,
							message: r.message
						});
						return;
					}
					console.log(`[dsh-proxy] proxy ENABLED url=${url} mode=${mode} providers=[${providers.join(",")}] hosts=[${[...selectedHosts({ providers })].join(",")}]`);
				} else {
					clearProxy();
					console.log("[dsh-proxy] proxy DISABLED");
				}
				if (scope !== void 0) try {
					await scope.update({
						enabled,
						url,
						mode,
						providers
					});
				} catch (err) {
					console.log("[dsh-proxy] persist failed:", err?.message ?? err);
				}
				writeJson(res, {
					ok: true,
					enabled,
					url,
					mode,
					providers,
					hosts: [...selectedHosts({ providers })],
					active: isActive()
				});
			} catch (error) {
				writeJson(res, {
					ok: false,
					error: String(error?.message ?? error)
				});
			}
		}
	}), "webui: dsh-proxy set");
}
//#endregion
//#region src/browser/cdp.ts
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
var CdpConnection = class {
	url;
	ws = null;
	nextId = 1;
	pending = /* @__PURE__ */ new Map();
	listeners = /* @__PURE__ */ new Map();
	constructor(url) {
		this.url = url;
	}
	/** 连接并等待 open */
	async connect(timeoutMs = 1e4) {
		if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
		await new Promise((resolve, reject) => {
			const ws = new WebSocket(this.url);
			const timer = setTimeout(() => {
				ws.close();
				reject(/* @__PURE__ */ new Error(`CDP 连接超时: ${this.url}`));
			}, timeoutMs);
			ws.onopen = () => {
				clearTimeout(timer);
				this.ws = ws;
				resolve();
			};
			ws.onerror = (e) => {
				clearTimeout(timer);
				reject(/* @__PURE__ */ new Error(`CDP 连接失败: ${e?.message || "unknown"}`));
			};
		});
		this.ws.onmessage = (ev) => this.onMessage(ev);
		this.ws.onclose = () => this.onClose();
	}
	get connected() {
		return !!this.ws && this.ws.readyState === WebSocket.OPEN;
	}
	onMessage(ev) {
		let msg;
		try {
			msg = JSON.parse(String(ev.data));
		} catch {
			return;
		}
		if (msg.id && this.pending.has(msg.id)) {
			const p = this.pending.get(msg.id);
			this.pending.delete(msg.id);
			if (msg.error) p.reject(/* @__PURE__ */ new Error(`${p.method}: ${msg.error.message || JSON.stringify(msg.error)}`));
			else p.resolve(msg.result);
			return;
		}
		if (msg.method && this.listeners.has(msg.method)) {
			const params = msg.sessionId ? {
				...msg.params || {},
				sessionId: msg.sessionId
			} : msg.params || {};
			for (const fn of this.listeners.get(msg.method)) try {
				fn(params);
			} catch {}
		}
	}
	onClose() {
		const err = /* @__PURE__ */ new Error("CDP 连接已关闭");
		for (const [, p] of this.pending) p.reject(err);
		this.pending.clear();
		this.ws = null;
	}
	/** 发送命令，返回 result（含 sessionId 时走 session 路由） */
	send(method, params = {}, sessionId) {
		if (!this.connected) throw new Error("CDP 未连接");
		const id = this.nextId++;
		const payload = {
			id,
			method,
			params
		};
		if (sessionId) payload.sessionId = sessionId;
		return new Promise((resolve, reject) => {
			this.pending.set(id, {
				resolve,
				reject,
				method
			});
			this.ws.send(JSON.stringify(payload));
		});
	}
	/** 订阅事件（返回取消函数）。监听器收到的 params 在 flatten 模式下含 sessionId 字段。 */
	on(method, fn) {
		if (!this.listeners.has(method)) this.listeners.set(method, /* @__PURE__ */ new Set());
		this.listeners.get(method).add(fn);
		return () => this.listeners.get(method)?.delete(fn);
	}
	close() {
		try {
			this.ws?.close();
		} catch {}
		this.ws = null;
	}
};
/** 从 http://127.0.0.1:port/json/version 读取 browser websocket 地址（100ms 快速轮询） */
async function fetchBrowserWsUrl(port, timeoutMs = 5e3) {
	const deadline = Date.now() + timeoutMs;
	let lastErr = null;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(`http://127.0.0.1:${port}/json/version`);
			if (res.ok) {
				const info = await res.json();
				if (info && typeof info.webSocketDebuggerUrl === "string") return info.webSocketDebuggerUrl;
			}
		} catch (e) {
			lastErr = e;
		}
		await sleep(100);
	}
	throw new Error(`Chrome DevTools 端口 ${port} 未就绪: ${String(lastErr || "timeout")}`);
}
/** 创建新标签页并 attach，返回 session */
async function createPageSession(conn, url = "about:blank") {
	const targetId = (await conn.send("Target.createTarget", { url })).targetId;
	return attachTarget(conn, targetId);
}
/** attach 已有 target */
async function attachTarget(conn, targetId) {
	return {
		targetId,
		sessionId: (await conn.send("Target.attachToTarget", {
			targetId,
			flatten: true
		})).sessionId,
		conn
	};
}
const NETIDLE_IDLE_MS = 300;
const NETIDLE_EXTRA_MS = 2500;
/** 等网络空闲：连续 idleMs 无新请求，最多额外等 extraMs */
async function waitForNetworkIdle(session, idleMs = NETIDLE_IDLE_MS, extraMs = NETIDLE_EXTRA_MS) {
	const { conn, sessionId } = session;
	let active = 0;
	let lastChange = Date.now();
	const onReq = (p) => {
		if (!p || p.sessionId === sessionId) {
			active++;
			lastChange = Date.now();
		}
	};
	const onDone = (p) => {
		if (!p || p.sessionId === sessionId) {
			active = Math.max(0, active - 1);
			lastChange = Date.now();
		}
	};
	const off1 = conn.on("Network.requestWillBeSent", onReq);
	const off2 = conn.on("Network.loadingFinished", onDone);
	const off3 = conn.on("Network.loadingFailed", onDone);
	try {
		const idleDeadline = Date.now() + extraMs;
		while (Date.now() < idleDeadline) {
			if (active === 0 && Date.now() - lastChange >= idleMs) break;
			await sleep(80);
		}
	} finally {
		off1();
		off2();
		off3();
	}
}
/**
* 等页面就绪：先轮询 document.readyState 直到 complete（兼容初次导航与
* 操作触发的二次导航），再等网络空闲。返回时页面已可稳定 snapshot。
*/
async function waitForPageReady(session, timeoutMs = 3e4) {
	const { conn, sessionId } = session;
	try {
		await conn.send("Network.enable", {}, sessionId);
	} catch {}
	try {
		await conn.send("Page.enable", {}, sessionId);
	} catch {}
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			if (await evaluateJson(session, "document.readyState", false) === "complete") break;
		} catch {}
		await sleep(120);
	}
	await waitForNetworkIdle(session);
}
/**
* 导航到 URL 并等待页面就绪（load + 网络空闲）。
*/
async function navigateAndWait(session, url, timeoutMs = 3e4) {
	const { conn, sessionId } = session;
	try {
		await conn.send("Network.enable", {}, sessionId);
	} catch {}
	try {
		await conn.send("Page.enable", {}, sessionId);
	} catch {}
	await conn.send("Page.navigate", { url }, sessionId);
	await waitForPageReady(session, timeoutMs);
	const info = await conn.send("Page.getNavigationHistory", {}, sessionId);
	const current = info?.entries?.[info.currentIndex];
	return {
		url: current?.url || url,
		title: current?.title || ""
	};
}
/** 历史前进/后退（delta 正=前进，负=后退） */
async function navigateHistory(session, delta) {
	const { conn, sessionId } = session;
	const info = await conn.send("Page.getNavigationHistory", {}, sessionId);
	const target = (info?.entries || [])[(info?.currentIndex ?? -1) + delta];
	if (!target) throw new Error(delta < 0 ? "没有可后退的历史记录" : "没有可前进的历史记录");
	await conn.send("Page.navigateToHistoryEntry", { entryId: target.id }, sessionId);
	await waitForPageReady(session);
	const after = await conn.send("Page.getNavigationHistory", {}, sessionId);
	const current = after?.entries?.[after.currentIndex];
	return {
		url: current?.url || "",
		title: current?.title || ""
	};
}
/** 页面截图（jpeg base64） */
async function captureScreenshot(session, quality = 80) {
	const { conn, sessionId } = session;
	const shot = await conn.send("Page.captureScreenshot", {
		format: "jpeg",
		quality,
		fromSurface: true
	}, sessionId);
	if (!shot?.data) throw new Error("截图失败：CDP 未返回图像数据");
	return shot.data;
}
/** 页面执行 JS，返回 JSON 值 */
async function evaluateJson(session, expression, awaitPromise = true) {
	const { conn, sessionId } = session;
	const result = await conn.send("Runtime.evaluate", {
		expression,
		awaitPromise,
		returnByValue: true
	}, sessionId);
	if (result?.exceptionDetails) {
		const d = result.exceptionDetails;
		throw new Error(`页面 JS 异常: ${d.text || "unknown"} ${d.exception?.description || ""}`.slice(0, 400));
	}
	return result?.result?.value;
}
/**
* 真实坐标鼠标点击（CDP Input 域）。
* 触发完整事件链：mouseover → mousedown → mouseup → click，以及 pointer 事件，
* 对依赖真实命中的元素（canvas、验证码滑块、部分自定义控件）比合成事件更精准。
*/
async function dispatchMouseClick(session, x, y) {
	const { conn, sessionId } = session;
	await conn.send("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		x,
		y,
		button: "none"
	}, sessionId);
	await conn.send("Input.dispatchMouseEvent", {
		type: "mousePressed",
		x,
		y,
		button: "left",
		clickCount: 1
	}, sessionId);
	await conn.send("Input.dispatchMouseEvent", {
		type: "mouseReleased",
		x,
		y,
		button: "left",
		clickCount: 1
	}, sessionId);
}
/** 真实鼠标移动（悬停，用于触发 hover 菜单/下拉） */
async function dispatchMouseMove(session, x, y) {
	const { conn, sessionId } = session;
	await conn.send("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		x,
		y,
		button: "none"
	}, sessionId);
}
/** 真实文本插入（写入当前焦点/选区的输入控件，走浏览器原生输入路径） */
async function insertText(session, text) {
	const { conn, sessionId } = session;
	await conn.send("Input.insertText", { text }, sessionId);
}
/** 真实回车键（rawKeyDown + char + keyUp，兼容监听 keypress/keydown 的表单） */
async function dispatchEnterKey(session) {
	await dispatchKey(session, "Enter");
}
const MOD_BITS = {
	alt: 1,
	ctrl: 2,
	control: 2,
	meta: 4,
	cmd: 4,
	shift: 8
};
const KEY_DEFS = {
	Enter: {
		key: "Enter",
		code: "Enter",
		vk: 13,
		text: "\r"
	},
	Escape: {
		key: "Escape",
		code: "Escape",
		vk: 27
	},
	Tab: {
		key: "Tab",
		code: "Tab",
		vk: 9
	},
	Backspace: {
		key: "Backspace",
		code: "Backspace",
		vk: 8
	},
	Delete: {
		key: "Delete",
		code: "Delete",
		vk: 46
	},
	ArrowUp: {
		key: "ArrowUp",
		code: "ArrowUp",
		vk: 38
	},
	ArrowDown: {
		key: "ArrowDown",
		code: "ArrowDown",
		vk: 40
	},
	ArrowLeft: {
		key: "ArrowLeft",
		code: "ArrowLeft",
		vk: 37
	},
	ArrowRight: {
		key: "ArrowRight",
		code: "ArrowRight",
		vk: 39
	},
	Home: {
		key: "Home",
		code: "Home",
		vk: 36
	},
	End: {
		key: "End",
		code: "End",
		vk: 35
	},
	PageUp: {
		key: "PageUp",
		code: "PageUp",
		vk: 33
	},
	PageDown: {
		key: "PageDown",
		code: "PageDown",
		vk: 34
	},
	" ": {
		key: " ",
		code: "Space",
		vk: 32,
		text: " "
	}
};
/**
* 真实键盘按键（rawKeyDown + 可选 char + keyUp）。
* @param key 按键名（Enter/Escape/Tab/ArrowUp…）或单字符
* @param modifiers 修饰键数组（ctrl/shift/alt/meta），如 ['ctrl','shift']
*/
async function dispatchKey(session, key, modifiers = []) {
	const { conn, sessionId } = session;
	const def = KEY_DEFS[key] || {
		key,
		code: key.length === 1 ? "Key" + key.toUpperCase() : key,
		vk: 0,
		text: key
	};
	let mods = 0;
	for (const m of modifiers) mods |= MOD_BITS[String(m).toLowerCase()] || 0;
	const base = {
		key: def.key,
		code: def.code,
		windowsVirtualKeyCode: def.vk,
		nativeVirtualKeyCode: def.vk
	};
	if (mods) base.modifiers = mods;
	await conn.send("Input.dispatchKeyEvent", {
		type: "rawKeyDown",
		...base
	}, sessionId);
	if (def.text != null) await conn.send("Input.dispatchKeyEvent", {
		type: "char",
		text: def.text,
		key: def.key,
		code: def.code,
		windowsVirtualKeyCode: def.vk
	}, sessionId);
	await conn.send("Input.dispatchKeyEvent", {
		type: "keyUp",
		...base
	}, sessionId);
}
//#endregion
//#region src/browser/chrome.ts
/**
* Chrome 进程管理：启动独立实例（固定 user-data-dir、自动端口探测）。
*/
const DEFAULT_CHROME_CANDIDATES = [
	process.env.CHROME_PATH || "",
	"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
	"C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
	"C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
	"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
	"/usr/bin/google-chrome",
	"/usr/bin/chromium",
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
].filter(Boolean);
function resolveChromePath(candidates) {
	for (const c of candidates) if (c && fs.existsSync(c)) return c;
	throw new Error(`未找到 Chrome/Edge：请通过插件配置 chromePath 指定（已尝试：${candidates.join(", ")}）`);
}
/** 探测空闲端口（从 base 开始） */
async function findFreePort(base = 9222, maxTries = 20) {
	for (let p = base; p < base + maxTries; p++) if (await isPortFree(p)) return p;
	throw new Error(`端口 ${base}~${base + maxTries} 均被占用`);
}
function isPortFree(port) {
	return new Promise((resolve) => {
		const srv = net.createServer();
		srv.once("error", () => resolve(false));
		srv.once("listening", () => srv.close(() => resolve(true)));
		srv.listen(port, "127.0.0.1");
	});
}
/**
* 启动 Chrome。幂等由调用方保证（port/profile 检查）。
* @param chromePath Chrome 可执行文件路径
* @param profileDir 独立用户数据目录（cookies/登录态持久化）
* @param port CDP 端口（调用方先 findFreePort）
* @param headless 无头模式
* @param args 附加参数
*/
function launchChrome(chromePath, profileDir, port, headless = false, args = []) {
	fs.mkdirSync(profileDir, { recursive: true });
	const proc = spawn(chromePath, [
		`--remote-debugging-port=${port}`,
		`--remote-debugging-address=127.0.0.1`,
		`--remote-allow-origins=*`,
		`--user-data-dir=${profileDir}`,
		"--no-first-run",
		"--no-default-browser-check",
		"--disable-features=Translate,MediaRouter",
		...headless ? ["--headless=new", "--disable-gpu"] : [],
		...args,
		"about:blank"
	], {
		stdio: "ignore",
		windowsHide: false
	});
	proc.on("error", (err) => {
		console.error(`[dsh-browser] chrome spawn error: ${err.message}`);
	});
	return {
		proc,
		port,
		profileDir
	};
}
function killChrome(runtime, force = false) {
	if (!runtime) return;
	const { proc } = runtime;
	if (proc && !proc.killed) try {
		if (force || process.platform === "win32") proc.kill("SIGKILL");
		else proc.kill("SIGTERM");
	} catch {}
}
//#endregion
//#region src/browser/snapshot.ts
const MAX_REFS = 250;
const COLLECT_JS = `(function () {
  var MAX_REFS = ${MAX_REFS};
  function isVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    var r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    var cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity || 1) > 0.05;
  }
  function str(s, n) {
    s = (s == null ? '' : String(s)).replace(/\\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n) : s;
  }
  function describe(el) {
    var tag = el.tagName.toLowerCase();
    var parts = [tag];
    var type = el.getAttribute && el.getAttribute('type');
    if (type) parts.push('type=' + type);
    var name = el.getAttribute && el.getAttribute('name');
    if (name) parts.push('name=' + str(name, 40));
    if (el.id) parts.push('id=' + str(el.id, 40));
    if (tag === 'input' && el.value != null && el.value !== '') {
      parts.push('value=' + str(type === 'password' ? '(已填写)' : el.value, 40));
    }
    if (tag === 'textarea' && el.value) parts.push('value=' + str(el.value, 40));
    if (el.disabled) parts.push('disabled');
    if (tag === 'input' && (type === 'checkbox' || type === 'radio')) parts.push(el.checked ? 'checked' : 'unchecked');
    if (el.hasAttribute && el.hasAttribute('aria-pressed')) parts.push('aria-pressed=' + el.getAttribute('aria-pressed'));
    if (el.hasAttribute && el.hasAttribute('aria-expanded')) parts.push('aria-expanded=' + el.getAttribute('aria-expanded'));
    if (el.hasAttribute && el.hasAttribute('aria-selected')) parts.push('aria-selected=' + el.getAttribute('aria-selected'));
    var text = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
    if (text) parts.push('"' + (text.length > 60 ? text.slice(0, 60) : text) + '"');
    var ph = el.getAttribute && el.getAttribute('placeholder');
    if (ph) parts.push('ph=' + str(ph, 40));
    var role = el.getAttribute && el.getAttribute('role');
    if (role) parts.push('role=' + role);
    var aria = el.getAttribute && el.getAttribute('aria-label');
    if (aria) parts.push('aria=' + str(aria, 60));
    var title = el.getAttribute && el.getAttribute('title');
    if (title) parts.push('title=' + str(title, 60));
    if (tag === 'a' && el.getAttribute('href')) parts.push('href=' + str(el.getAttribute('href'), 80));
    if (tag === 'select') {
      var opts = [];
      for (var o = 0; o < el.options.length && o < 10; o++) {
        opts.push(str(el.options[o].text || el.options[o].value, 24));
      }
      if (opts.length) parts.push('options=[' + opts.join(' | ') + (el.options.length > 10 ? ' …' : '') + ']');
    }
    if (tag === 'img') {
      var alt = el.getAttribute && el.getAttribute('alt');
      if (alt) parts.push('alt=' + str(alt, 40));
    }
    return parts.join(' ');
  }
  // 清除旧标记，防止动态页面残留的 data-dsh-ref 与本次编号错位
  var stale = document.querySelectorAll('[data-dsh-ref]');
  for (var s = 0; s < stale.length; s++) stale[s].removeAttribute('data-dsh-ref');
  var refs = [];
  var els = document.querySelectorAll('a[href],button,input,textarea,select,[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="tab"],[role="menuitem"],[role="option"],[role="switch"],[onclick],[tabindex],summary,[contenteditable="true"],[contenteditable=""],[contenteditable="plaintext-only"],img');
  var truncated = false;
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    if (!isVisible(el)) continue;
    if (el.tagName === 'IMG') {
      var ialt = el.getAttribute && el.getAttribute('alt');
      if (!ialt && !el.getAttribute('title')) continue;
    }
    if (refs.length >= MAX_REFS) { truncated = true; break; }
    var ref = refs.length + 1;
    el.setAttribute('data-dsh-ref', String(ref));
    refs.push({ ref: ref, desc: describe(el) });
  }
  var bodyText = (document.body && document.body.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 1500);
  return { url: location.href, title: document.title, refs: refs, bodyText: bodyText, truncated: truncated };
})()`;
const GET_RECT_JS = `(function (ref) {
  var el = document.querySelector('[data-dsh-ref="' + ref + '"]');
  if (!el) return { ok: false, error: 'ref ' + ref + ' 不存在（页面可能已变化，请重新 snapshot）' };
  try { el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); }
  catch (e) { try { el.scrollIntoView({ block: 'center' }); } catch (e2) {} }
  var r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return { ok: false, error: 'ref ' + ref + ' 元素不可见（宽高为 0）' };
  var cx = Math.round(r.left + r.width / 2);
  var cy = Math.round(r.top + r.height / 2);
  return { ok: true, x: cx, y: cy, tag: el.tagName.toLowerCase(), text: (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 40) };
})`;
const FOCUS_SELECT_JS = `(function (ref) {
  var el = document.querySelector('[data-dsh-ref="' + ref + '"]');
  if (!el) return { ok: false, error: 'ref ' + ref + ' 不存在（页面可能已变化，请重新 snapshot）' };
  var tag = el.tagName;
  if (tag === 'SELECT') return { ok: true, tag: 'SELECT' };
  var editable = tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
  if (!editable) return { ok: false, error: 'ref ' + ref + ' 不是输入控件（' + tag + '）' };
  try { el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); }
  catch (e) { try { el.scrollIntoView({ block: 'center' }); } catch (e2) {} }
  try { el.focus(); } catch (e) {}
  try {
    if (typeof el.select === 'function') el.select();
    else if (el.isContentEditable) {
      var range = document.createRange();
      range.selectNodeContents(el);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
  } catch (e) {}
  return { ok: true, tag: tag, type: el.type || '' };
})`;
const SELECT_SET_JS = `(function (ref, value) {
  var el = document.querySelector('[data-dsh-ref="' + ref + '"]');
  if (!el) return { ok: false, error: 'ref ' + ref + ' 不存在（页面可能已变化，请重新 snapshot）' };
  if (el.tagName !== 'SELECT') return { ok: false, error: 'ref ' + ref + ' 不是下拉框（' + el.tagName + '）' };
  var v = String(value);
  var proto = HTMLSelectElement.prototype;
  var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  var matched = false;
  for (var i = 0; i < el.options.length; i++) {
    var opt = el.options[i];
    var label = (opt.text || opt.value || '').replace(/\\s+/g, ' ').trim();
    if (opt.value === v || label === v) {
      setter.call(el, opt.value);
      matched = true;
      break;
    }
  }
  if (!matched) return { ok: false, error: '未找到匹配选项 "' + v + '"，可用 browser_evaluate 查看 options' };
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true, value: el.value };
})`;
const SCROLL_JS = `(function (direction, amount) {
  var v = Number(amount) || 3;
  var dx = 0, dy = 0;
  if (direction === 'left' || direction === 'right') dx = v * 250 * (direction === 'left' ? -1 : 1);
  else dy = v * 400 * (direction === 'up' ? -1 : 1);
  window.scrollBy({ top: dy, left: dx, behavior: 'instant' });
  return { ok: true };
})`;
const WAIT_SETTLE_JS = `(function (idleMs, timeoutMs) {
  return new Promise(function (resolve) {
    var t = null;
    function settle() { resolve(true); }
    function reset() { if (t) clearTimeout(t); t = setTimeout(settle, idleMs); }
    var mo = null;
    try {
      mo = new MutationObserver(reset);
      mo.observe(document, { childList: true, subtree: true, attributes: true, characterData: true });
    } catch (e) { resolve(true); return; }
    reset();
    setTimeout(function () { resolve(false); }, timeoutMs);
  });
})`;
async function getSnapshot(session) {
	const data = await evaluateJson(session, COLLECT_JS);
	if (!data || !Array.isArray(data.refs)) throw new Error("snapshot 失败：页面无有效响应");
	const lines = [];
	lines.push(`URL: ${data.url || "(空白页)"}`);
	if (data.title) lines.push(`标题: ${String(data.title).slice(0, 120)}`);
	lines.push("可交互元素（ref 定位，页面变化后请重新 snapshot）:");
	if (data.refs.length === 0) lines.push("  （无可见可交互元素）");
	for (const r of data.refs) lines.push(`  [${r.ref}] ${r.desc}`);
	if (data.truncated) lines.push(`  （元素过多，已截断至前 ${MAX_REFS} 个，其余用 browser_evaluate 定位）`);
	if (data.bodyText) {
		lines.push("页面正文摘要:");
		lines.push(String(data.bodyText).slice(0, 1200));
	}
	return {
		text: lines.join("\n"),
		url: data.url || "",
		title: data.title || "",
		refCount: data.refs.length,
		truncated: !!data.truncated
	};
}
/** 等 DOM 静默。返回 settled（静默/超时）与 nav（是否发生导航）。 */
async function waitForSettle(session, idleMs = 250, timeoutMs = 2e3) {
	try {
		return {
			settled: !!await evaluateJson(session, `${WAIT_SETTLE_JS}(${Number(idleMs)}, ${Number(timeoutMs)})`, true),
			nav: false
		};
	} catch {
		return {
			settled: false,
			nav: true
		};
	}
}
async function clickRef(session, ref) {
	const rect = await evaluateJson(session, `${GET_RECT_JS}(${Number(ref)})`);
	if (!rect) throw new Error("定位元素失败");
	if (rect.ok === false) throw new Error(String(rect.error || "点击失败"));
	await dispatchMouseClick(session, rect.x, rect.y);
}
async function hoverRef(session, ref) {
	const rect = await evaluateJson(session, `${GET_RECT_JS}(${Number(ref)})`);
	if (!rect) throw new Error("定位元素失败");
	if (rect.ok === false) throw new Error(String(rect.error || "悬停失败"));
	await dispatchMouseMove(session, rect.x, rect.y);
}
async function typeRef(session, ref, text, pressEnter) {
	const info = await evaluateJson(session, `${FOCUS_SELECT_JS}(${Number(ref)})`);
	if (!info) throw new Error("定位输入元素失败");
	if (info.ok === false) throw new Error(String(info.error || "输入失败"));
	if (info.tag === "SELECT") {
		await selectRef(session, ref, text);
		return;
	}
	await insertText(session, String(text));
	if (pressEnter) await dispatchEnterKey(session);
}
async function selectRef(session, ref, value) {
	const safeValue = JSON.stringify(String(value));
	const result = await evaluateJson(session, `${SELECT_SET_JS}(${Number(ref)}, ${safeValue})`);
	if (!result) throw new Error("下拉选择失败");
	if (result.ok === false) throw new Error(String(result.error || "下拉选择失败"));
}
async function scrollPage(session, direction, amount) {
	await evaluateJson(session, `${SCROLL_JS}(${JSON.stringify(direction)}, ${Number(amount) || 3})`);
}
Schema.object({
	chromePath: Schema.string().default(""),
	port: Schema.number().default(0),
	headless: Schema.boolean().default(false),
	screenshotDir: Schema.string().default("")
});
const MAX_LOG = 200;
const NAV_TIMEOUT_MS = 3e4;
const SETTLE_IDLE_MS = 250;
const SETTLE_TIMEOUT_MS = 2e3;
const DEFAULT_SEE_PROMPT = "描述当前浏览器页面可见区域：整体布局（顶部导航/侧边栏/主内容区）、所有可见的按钮、输入框、链接及它们的文字，以及当前是否有弹窗/对话框。用于辅助网页操作，请具体到可点击/可输入元素，看不清就直说。";
function applyBrowser(ctx, config) {
	const dataRoot = path.join(process.env.DSH_HOME || path.join(process.env.USERPROFILE || process.env.HOME || ".", ".dsh"), "plugin-data", "dsh-browser");
	const prefsFile = path.join(dataRoot, "prefs.json");
	let allowBrowser = true;
	function loadPrefs() {
		try {
			allowBrowser = JSON.parse(fs.readFileSync(prefsFile, "utf8"))?.allowBrowser !== false;
		} catch {
			allowBrowser = true;
		}
	}
	function savePrefs() {
		try {
			fs.mkdirSync(dataRoot, { recursive: true });
			fs.writeFileSync(prefsFile, JSON.stringify({ allowBrowser }, null, 2) + "\n");
		} catch {}
	}
	loadPrefs();
	const state = {
		runtime: null,
		conn: null,
		session: null,
		screenshotDir: "",
		lastScreenshotPath: null,
		log: []
	};
	const log = (action, detail = "") => {
		state.log.push({
			ts: (/* @__PURE__ */ new Date()).toISOString(),
			action,
			detail: String(detail).slice(0, 200)
		});
		if (state.log.length > MAX_LOG) state.log.splice(0, state.log.length - MAX_LOG);
	};
	ctx.effect(() => ctx.on("tools/pre-execute", async (exec, next) => {
		if (typeof exec?.name === "string" && exec.name.startsWith("browser_") && !allowBrowser) return {
			kind: "deny",
			reason: "浏览器使用已被用户禁用（可在对话面板开关中开启）"
		};
		return next();
	}), "@dsh-external/dsh-browser: allow gate");
	async function startBrowser() {
		if (state.conn?.connected && state.session) return {
			ok: true,
			alreadyRunning: true,
			...await statusFields()
		};
		if (!!state.runtime && state.runtime.proc.exitCode === null && !state.runtime.proc.killed) {
			if (state.conn) try {
				state.conn.close();
			} catch {}
			state.conn = null;
		} else {
			const chromePath = config.chromePath || resolveChromePath(DEFAULT_CHROME_CANDIDATES);
			const port = config.port || await findFreePort(9222);
			const profileDir = path.join(dataRoot, "profiles", "default");
			state.runtime = launchChrome(chromePath, profileDir, port, config.headless);
			state.screenshotDir = config.screenshotDir || path.join(profileDir, "screenshots");
			fs.mkdirSync(state.screenshotDir, { recursive: true });
			log("start", `${chromePath} port=${port} headless=${config.headless}`);
		}
		const wsUrl = await fetchBrowserWsUrl(state.runtime.port, 15e3);
		const conn = new CdpConnection(wsUrl);
		await conn.connect(1e4);
		state.conn = conn;
		state.session = await createPageSession(conn);
		log("ready", wsUrl);
		return {
			ok: true,
			...await statusFields()
		};
	}
	async function stopBrowser() {
		if (state.conn) try {
			state.conn.close();
		} catch {}
		state.conn = null;
		state.session = null;
		killChrome(state.runtime);
		state.runtime = null;
		log("stop", "browser closed");
		return {
			ok: true,
			running: false
		};
	}
	async function requireSession() {
		if (!state.conn?.connected || !state.session) await startBrowser();
		if (!state.conn?.connected || !state.session) throw new Error("浏览器未就绪，请先调用 browser_start");
		return state.session;
	}
	async function statusFields() {
		const running = !!state.runtime && !state.runtime.proc.killed && !!state.conn?.connected;
		let url = "";
		let title = "";
		let refCount = 0;
		if (running && state.session) try {
			const snap = await getSnapshot(state.session);
			url = snap.url;
			title = snap.title;
			refCount = snap.refCount;
		} catch {}
		return {
			running,
			url,
			title,
			refCount,
			port: state.runtime?.port ?? null,
			headless: config.headless
		};
	}
	/**
	* 操作后的统一收尾：等 DOM 静默（或等导航后的页面就绪），再返回最新快照。
	* 这是减少「快照陈旧 → 模型反复重试」的关键。
	*/
	async function settleAndSnapshot(session) {
		const st = await waitForSettle(session, SETTLE_IDLE_MS, SETTLE_TIMEOUT_MS);
		if (st.nav) await waitForPageReady(session, NAV_TIMEOUT_MS);
		const snap = await getSnapshot(session);
		return {
			snapshot: snap.text,
			url: snap.url,
			title: snap.title,
			refCount: snap.refCount,
			navigated: st.nav
		};
	}
	const tools = [
		defineTool({
			name: "browser_start",
			description: "启动 AI 专用 Chrome 实例（独立配置目录、登录态持久化）。AI 操作浏览器前第一步调用；重复调用返回当前状态。",
			parameters: {},
			output: {
				schema: { type: "json" },
				render: (_a, v) => [{
					type: "text",
					text: JSON.stringify(v, null, 2)
				}]
			},
			async execute() {
				try {
					return await startBrowser();
				} catch (e) {
					return {
						ok: false,
						error: String(e?.message || e)
					};
				}
			}
		}),
		defineTool({
			name: "browser_navigate",
			description: "在浏览器打开 URL 并等待加载（load + 网络空闲），返回页面 ref 树。",
			parameters: { url: {
				type: "string",
				required: true,
				description: "要打开的网址（http/https）"
			} },
			output: {
				schema: { type: "json" },
				render: (_a, v) => [{
					type: "text",
					text: JSON.stringify(v, null, 2)
				}]
			},
			async execute(args) {
				try {
					const session = await requireSession();
					const url = String(args.url).trim();
					if (!/^https?:\/\//i.test(url)) throw new Error("仅支持 http/https 地址");
					const info = await navigateAndWait(session, url, NAV_TIMEOUT_MS);
					const snap = await getSnapshot(session);
					log("navigate", url);
					return {
						ok: true,
						url: info.url,
						title: info.title,
						snapshot: snap.text
					};
				} catch (e) {
					return {
						ok: false,
						error: String(e?.message || e)
					};
				}
			}
		}),
		defineTool({
			name: "browser_snapshot",
			description: "获取当前页面 ref 树：元素以 [ref] 定位。页面变化后 ref 失效，操作前先获取最新 snapshot。",
			parameters: {},
			output: {
				schema: { type: "json" },
				render: (_a, v) => [{
					type: "text",
					text: JSON.stringify(v, null, 2)
				}]
			},
			async execute() {
				try {
					const snap = await getSnapshot(await requireSession());
					return {
						ok: true,
						url: snap.url,
						title: snap.title,
						snapshot: snap.text
					};
				} catch (e) {
					return {
						ok: false,
						error: String(e?.message || e)
					};
				}
			}
		}),
		defineTool({
			name: "browser_click",
			description: "点击页面元素（ref 来自最新 snapshot），返回操作后最新 snapshot。连续操作已知不变的页面时，可设 returnSnapshot=false 跳过快照以提速。",
			parameters: {
				ref: {
					type: "number",
					required: true,
					description: "snapshot 中的 [ref] 编号"
				},
				returnSnapshot: {
					type: "boolean",
					description: "是否返回操作后快照（默认 true）"
				}
			},
			output: {
				schema: { type: "json" },
				render: (_a, v) => [{
					type: "text",
					text: JSON.stringify(v, null, 2)
				}]
			},
			async execute(args) {
				try {
					const session = await requireSession();
					await clickRef(session, Number(args.ref));
					log("click", `ref=${args.ref}`);
					if (args.returnSnapshot === false) return { ok: true };
					return {
						ok: true,
						...await settleAndSnapshot(session)
					};
				} catch (e) {
					return {
						ok: false,
						error: String(e?.message || e)
					};
				}
			}
		}),
		defineTool({
			name: "browser_type",
			description: "向输入框输入文本（ref 来自最新 snapshot）。对下拉框 select 也会按文本/值选择。返回操作后最新 snapshot；可设 returnSnapshot=false 跳过。",
			parameters: {
				ref: {
					type: "number",
					required: true,
					description: "snapshot 中的 [ref] 编号"
				},
				text: {
					type: "string",
					required: true,
					description: "要输入的文本"
				},
				pressEnter: {
					type: "boolean",
					description: "输入后按回车（提交表单/搜索），默认 false"
				},
				returnSnapshot: {
					type: "boolean",
					description: "是否返回操作后快照（默认 true）"
				}
			},
			output: {
				schema: { type: "json" },
				render: (_a, v) => [{
					type: "text",
					text: JSON.stringify(v, null, 2)
				}]
			},
			async execute(args) {
				try {
					const session = await requireSession();
					await typeRef(session, Number(args.ref), String(args.text), args.pressEnter === true);
					log("type", `ref=${args.ref} enter=${!!args.pressEnter}`);
					if (args.returnSnapshot === false) return { ok: true };
					return {
						ok: true,
						...await settleAndSnapshot(session)
					};
				} catch (e) {
					return {
						ok: false,
						error: String(e?.message || e)
					};
				}
			}
		}),
		defineTool({
			name: "browser_select",
			description: "在下拉框 select 中选择一个选项（按选项值或可见文本匹配）。ref 来自最新 snapshot。",
			parameters: {
				ref: {
					type: "number",
					required: true,
					description: "snapshot 中 select 元素的 [ref] 编号"
				},
				value: {
					type: "string",
					required: true,
					description: "要选择的选项值或可见文本"
				},
				returnSnapshot: {
					type: "boolean",
					description: "是否返回操作后快照（默认 true）"
				}
			},
			output: {
				schema: { type: "json" },
				render: (_a, v) => [{
					type: "text",
					text: JSON.stringify(v, null, 2)
				}]
			},
			async execute(args) {
				try {
					const session = await requireSession();
					await selectRef(session, Number(args.ref), String(args.value));
					log("select", `ref=${args.ref} value=${args.value}`);
					if (args.returnSnapshot === false) return { ok: true };
					return {
						ok: true,
						...await settleAndSnapshot(session)
					};
				} catch (e) {
					return {
						ok: false,
						error: String(e?.message || e)
					};
				}
			}
		}),
		defineTool({
			name: "browser_hover",
			description: "将鼠标悬停到元素上（ref 来自最新 snapshot），用于触发 hover 菜单/下拉/提示。返回操作后最新 snapshot。",
			parameters: {
				ref: {
					type: "number",
					required: true,
					description: "snapshot 中的 [ref] 编号"
				},
				returnSnapshot: {
					type: "boolean",
					description: "是否返回操作后快照（默认 true）"
				}
			},
			output: {
				schema: { type: "json" },
				render: (_a, v) => [{
					type: "text",
					text: JSON.stringify(v, null, 2)
				}]
			},
			async execute(args) {
				try {
					const session = await requireSession();
					await hoverRef(session, Number(args.ref));
					log("hover", `ref=${args.ref}`);
					if (args.returnSnapshot === false) return { ok: true };
					return {
						ok: true,
						...await settleAndSnapshot(session)
					};
				} catch (e) {
					return {
						ok: false,
						error: String(e?.message || e)
					};
				}
			}
		}),
		defineTool({
			name: "browser_press",
			description: "发送键盘按键（真实按键事件），如 Escape 关闭弹窗、Enter 确认、箭头键、以及 ctrl+a 等组合键。返回操作后最新 snapshot。",
			parameters: {
				key: {
					type: "string",
					required: true,
					description: "按键名：Enter / Escape / Tab / Backspace / Delete / ArrowUp / ArrowDown / ArrowLeft / ArrowRight / Home / End / PageUp / PageDown，或单字符"
				},
				modifiers: {
					type: "array",
					items: { type: "string" },
					description: "修饰键数组：ctrl / shift / alt / meta，如 [\"ctrl\"] 配 key=\"a\" 表示 Ctrl+A"
				},
				returnSnapshot: {
					type: "boolean",
					description: "是否返回操作后快照（默认 true）"
				}
			},
			output: {
				schema: { type: "json" },
				render: (_a, v) => [{
					type: "text",
					text: JSON.stringify(v, null, 2)
				}]
			},
			async execute(args) {
				try {
					const session = await requireSession();
					await dispatchKey(session, String(args.key), Array.isArray(args.modifiers) ? args.modifiers : []);
					log("press", String(args.key));
					if (args.returnSnapshot === false) return { ok: true };
					return {
						ok: true,
						...await settleAndSnapshot(session)
					};
				} catch (e) {
					return {
						ok: false,
						error: String(e?.message || e)
					};
				}
			}
		}),
		defineTool({
			name: "browser_scroll",
			description: "滚动当前页面，返回操作后最新 snapshot（滚动可能触发懒加载，会等 DOM 稳定）。",
			parameters: {
				direction: {
					type: "string",
					required: true,
					description: "up / down / left / right"
				},
				amount: {
					type: "number",
					description: "滚动步数（默认 3）"
				},
				returnSnapshot: {
					type: "boolean",
					description: "是否返回操作后快照（默认 true）"
				}
			},
			output: {
				schema: { type: "json" },
				render: (_a, v) => [{
					type: "text",
					text: JSON.stringify(v, null, 2)
				}]
			},
			async execute(args) {
				try {
					const dir = String(args.direction);
					if (![
						"up",
						"down",
						"left",
						"right"
					].includes(dir)) throw new Error("direction 须为 up/down/left/right");
					const session = await requireSession();
					await scrollPage(session, dir, Number(args.amount) || 3);
					log("scroll", dir);
					if (args.returnSnapshot === false) return { ok: true };
					return {
						ok: true,
						...await settleAndSnapshot(session)
					};
				} catch (e) {
					return {
						ok: false,
						error: String(e?.message || e)
					};
				}
			}
		}),
		defineTool({
			name: "browser_back",
			description: "浏览器后退一页，返回新页面 snapshot。",
			parameters: { returnSnapshot: {
				type: "boolean",
				description: "是否返回操作后快照（默认 true）"
			} },
			output: {
				schema: { type: "json" },
				render: (_a, v) => [{
					type: "text",
					text: JSON.stringify(v, null, 2)
				}]
			},
			async execute(args) {
				try {
					const session = await requireSession();
					const info = await navigateHistory(session, -1);
					log("back", info.url);
					if (args.returnSnapshot === false) return {
						ok: true,
						...info
					};
					const snap = await getSnapshot(session);
					return {
						ok: true,
						...info,
						snapshot: snap.text
					};
				} catch (e) {
					return {
						ok: false,
						error: String(e?.message || e)
					};
				}
			}
		}),
		defineTool({
			name: "browser_forward",
			description: "浏览器前进一页，返回新页面 snapshot。",
			parameters: { returnSnapshot: {
				type: "boolean",
				description: "是否返回操作后快照（默认 true）"
			} },
			output: {
				schema: { type: "json" },
				render: (_a, v) => [{
					type: "text",
					text: JSON.stringify(v, null, 2)
				}]
			},
			async execute(args) {
				try {
					const session = await requireSession();
					const info = await navigateHistory(session, 1);
					log("forward", info.url);
					if (args.returnSnapshot === false) return {
						ok: true,
						...info
					};
					const snap = await getSnapshot(session);
					return {
						ok: true,
						...info,
						snapshot: snap.text
					};
				} catch (e) {
					return {
						ok: false,
						error: String(e?.message || e)
					};
				}
			}
		}),
		defineTool({
			name: "browser_evaluate",
			description: "在页面执行 JavaScript 表达式并返回结果（JSON 序列化）。用于处理 ref 树定位不到的元素（弹窗、iframe、自定义控件）。",
			parameters: { expression: {
				type: "string",
				required: true,
				description: "要执行的 JS 表达式，返回 JSON 可序列化的值"
			} },
			output: {
				schema: { type: "json" },
				render: (_a, v) => [{
					type: "text",
					text: JSON.stringify(v, null, 2)
				}]
			},
			async execute(args) {
				try {
					const value = await evaluateJson(await requireSession(), String(args.expression));
					log("evaluate", String(args.expression).slice(0, 120));
					return {
						ok: true,
						value
					};
				} catch (e) {
					return {
						ok: false,
						error: String(e?.message || e)
					};
				}
			}
		}),
		defineTool({
			name: "browser_see",
			description: "截取当前页面并用辅助视觉模型描述画面，同时返回最新 ref 树。当 ref 树定位不到元素（图标按钮、canvas、验证码、复杂布局、无文本控件）或需要理解页面整体画面时使用，一步拿到「视觉描述 + 可操作 ref 树」。",
			parameters: { prompt: {
				type: "string",
				description: "可选的视觉描述要求（默认聚焦可操作元素与布局）"
			} },
			output: {
				schema: { type: "json" },
				render: (_a, v) => [{
					type: "text",
					text: JSON.stringify(v, null, 2)
				}]
			},
			async execute(args) {
				try {
					const session = await requireSession();
					const base64 = await captureScreenshot(session);
					const file = path.join(state.screenshotDir, `see-${Date.now()}.jpg`);
					fs.writeFileSync(file, Buffer.from(base64, "base64"));
					state.lastScreenshotPath = file;
					let vision = "";
					let visionModel = "";
					let visionError = "";
					const describeFn = ctx.get("vision-describe");
					if (typeof describeFn === "function") try {
						const res = await describeFn(file, String(args.prompt || "").trim() || DEFAULT_SEE_PROMPT);
						if (res && res.ok && typeof res.text === "string") {
							vision = res.text;
							visionModel = res.model || "";
						} else visionError = res && res.error ? String(res.error) : "视觉描述未返回文本";
					} catch (e) {
						visionError = String(e?.message || e);
					}
					else visionError = "未检测到辅助视觉插件 dsh-vision-helper，仅返回 ref 树";
					const snap = await getSnapshot(session);
					log("see", `vision=${vision ? "ok" : "fail"}`);
					return {
						ok: true,
						url: snap.url,
						title: snap.title,
						snapshot: snap.text,
						vision,
						visionModel,
						screenshot: file,
						...visionError ? { visionError } : {}
					};
				} catch (e) {
					return {
						ok: false,
						error: String(e?.message || e)
					};
				}
			}
		}),
		defineTool({
			name: "browser_screenshot",
			description: "截图保存为文件并返回路径。需要看页面画面（图表/验证码/布局）时，用 vision_describe 读取该路径。",
			parameters: {},
			output: {
				schema: { type: "json" },
				render: (_a, v) => [{
					type: "text",
					text: JSON.stringify(v, null, 2)
				}]
			},
			async execute() {
				try {
					const base64 = await captureScreenshot(await requireSession());
					const file = path.join(state.screenshotDir, `shot-${Date.now()}.jpg`);
					fs.writeFileSync(file, Buffer.from(base64, "base64"));
					state.lastScreenshotPath = file;
					log("screenshot", file);
					return {
						ok: true,
						path: file,
						bytes: fs.statSync(file).size,
						hint: "如需看图内容，调用 vision_describe，image 参数传此路径"
					};
				} catch (e) {
					return {
						ok: false,
						error: String(e?.message || e)
					};
				}
			}
		}),
		defineTool({
			name: "browser_stop",
			description: "关闭 AI 浏览器实例。",
			parameters: {},
			output: {
				schema: { type: "json" },
				render: (_a, v) => [{
					type: "text",
					text: JSON.stringify(v, null, 2)
				}]
			},
			async execute() {
				try {
					return await stopBrowser();
				} catch (e) {
					return {
						ok: false,
						error: String(e?.message || e)
					};
				}
			}
		}),
		defineTool({
			name: "browser_status",
			description: "查询浏览器运行状态（运行中/URL/标题/元素数）。",
			parameters: {},
			output: {
				schema: { type: "json" },
				render: (_a, v) => [{
					type: "text",
					text: JSON.stringify(v, null, 2)
				}]
			},
			async execute() {
				try {
					return {
						ok: true,
						...await statusFields()
					};
				} catch (e) {
					return {
						ok: false,
						error: String(e?.message || e)
					};
				}
			}
		})
	];
	ctx.effect(() => {
		for (const tool of tools) ctx.tools.register(tool);
		return () => {
			if (state.conn) try {
				state.conn.close();
			} catch {}
			killChrome(state.runtime);
			state.runtime = null;
		};
	}, "@dsh-external/dsh-browser: tools");
	ctx.effect(() => {
		const webServer = ctx.webServer;
		if (!webServer) return () => {};
		return webServer.register({
			kind: "exact",
			path: "/api/dsh-browser/status",
			handler: async (_req, res) => {
				try {
					const body = JSON.stringify({
						ok: true,
						...await statusFields(),
						log: state.log.slice(-10)
					});
					res.writeHead(200, {
						"content-type": "application/json",
						"cache-control": "no-store"
					});
					res.end(body);
				} catch (e) {
					res.writeHead(500, { "content-type": "application/json" });
					res.end(JSON.stringify({
						ok: false,
						error: String(e?.message || e)
					}));
				}
			}
		});
	}, "@dsh-external/dsh-browser: status route");
	ctx.effect(() => {
		const webServer = ctx.webServer;
		if (!webServer) return () => {};
		return webServer.register({
			kind: "exact",
			path: "/api/dsh-browser/screenshot",
			handler: async (_req, res) => {
				try {
					if (!state.lastScreenshotPath || !fs.existsSync(state.lastScreenshotPath)) {
						res.writeHead(404, { "content-type": "application/json" });
						res.end(JSON.stringify({
							ok: false,
							error: "no screenshot yet"
						}));
						return;
					}
					const data = fs.readFileSync(state.lastScreenshotPath);
					res.writeHead(200, {
						"content-type": "image/jpeg",
						"cache-control": "no-store"
					});
					res.end(data);
				} catch (e) {
					res.writeHead(500, { "content-type": "application/json" });
					res.end(JSON.stringify({
						ok: false,
						error: String(e?.message || e)
					}));
				}
			}
		});
	}, "@dsh-external/dsh-browser: screenshot route");
	ctx.effect(() => {
		const webServer = ctx.webServer;
		if (!webServer) return () => {};
		return webServer.register({
			kind: "exact",
			path: "/api/dsh-browser/allow",
			handler: async (req, res) => {
				const respond = (status, payload) => {
					res.writeHead(status, {
						"content-type": "application/json",
						"cache-control": "no-store"
					});
					res.end(JSON.stringify(payload));
				};
				try {
					if (req.method === "POST") {
						const body = await new Promise((resolve) => {
							let data = "";
							req.on("data", (chunk) => {
								data += chunk;
							});
							req.on("end", () => {
								try {
									resolve(JSON.parse(data || "{}"));
								} catch {
									resolve(null);
								}
							});
							req.on("error", () => resolve(null));
						});
						if (!body || typeof body.allow !== "boolean") return respond(400, {
							ok: false,
							error: "allow 须为布尔值"
						});
						allowBrowser = body.allow;
						savePrefs();
						log("allow", String(allowBrowser));
						return respond(200, {
							ok: true,
							allow: allowBrowser
						});
					}
					respond(200, {
						ok: true,
						allow: allowBrowser
					});
				} catch (e) {
					respond(500, {
						ok: false,
						error: String(e?.message || e)
					});
				}
			}
		});
	}, "@dsh-external/dsh-browser: allow route");
	ctx.logger?.info?.("[dsh-browser] loaded (headless=" + config.headless + ", port=" + config.port + ")");
}
//#endregion
//#region src/memory/engine/store.ts
/**
* dsh-memory 文件存储层：entries.json / state.json / changes/<date>.jsonl /
* 各层 md 产物。所有写入走「tmp + rename」原子写，防止半写损坏。
* 数据根：${DSH_HOME:-~/.dsh}/memories/dsh-memory/（与 memory-evolve 遗留数据同根目录、不同前缀，互不读写）。
*/
/** 数据根目录。 */
function memoryHome() {
	return join(process.env.DSH_HOME ?? join(homedir(), ".dsh"), "memories", "dsh-memory");
}
/** workspace 路径 → 项目目录 hash（sha1 前 12 位）。 */
function projectHashOf(cwd) {
	return createHash("sha1").update(cwd).digest("hex").slice(0, 12);
}
/** 记忆条目稳定 id：mem_<sha1(content|scope|projectHash)>，同内容合并。 */
function entryIdOf(content, scope, projectHash) {
	const key = `${scope}\u0000${projectHash ?? ""}\u0000${content.trim()}`;
	return `mem_${createHash("sha1").update(key).digest("hex").slice(0, 16)}`;
}
/** 本地日期 YYYY-MM-DD。 */
function localDate(date = /* @__PURE__ */ new Date()) {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
/** ISO 时间（本地时区偏移保留）。 */
function nowIso() {
	return (/* @__PURE__ */ new Date()).toISOString();
}
/** 原子写文本：tmp + rename（同一目录内）。 */
async function atomicWriteText(file, content) {
	await mkdir(join(file, ".."), { recursive: true });
	const temp = `${file}.tmp`;
	await writeFile(temp, content, "utf8");
	await rename(temp, file);
}
/** 原子写 JSON。 */
async function atomicWriteJson(file, value) {
	await atomicWriteText(file, `${JSON.stringify(value, null, 2)}\n`);
}
/** 读取 JSON，缺失/损坏返回 fallback。 */
async function readJson(file, fallback) {
	try {
		return JSON.parse(await readFile(file, "utf8"));
	} catch {
		return fallback;
	}
}
/** 追加一行 JSONL（追加本身用 appendFile；损坏容忍，读侧幂等）。 */
async function appendJsonl(file, value) {
	await mkdir(join(file, ".."), { recursive: true });
	const { appendFile } = await import("node:fs/promises");
	await appendFile(file, `${JSON.stringify(value)}\n`, "utf8");
}
/** 读取 JSONL（容忍坏行），返回 { entries, seq }。 */
async function readJsonl(file) {
	let raw;
	try {
		raw = await readFile(file, "utf8");
	} catch {
		return [];
	}
	const out = [];
	for (const line of raw.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (trimmed === "") continue;
		try {
			out.push(JSON.parse(trimmed));
		} catch {}
	}
	return out;
}
/**
* MemoryStore：所有记忆数据的读写入口。
* 线程模型：调用方（ticker / turn/end 捕获）通过同一实例串行化写入，
* 内部只保证单文件操作的原子性。
*/
var MemoryStore = class {
	root;
	constructor(root = memoryHome()) {
		this.root = root;
	}
	entriesFile() {
		return join(this.root, "store", "entries.json");
	}
	stateFile() {
		return join(this.root, "store", "state.json");
	}
	changesFile(date) {
		return join(this.root, "changes", `${date}.jsonl`);
	}
	globalDir() {
		return join(this.root, "global");
	}
	projectDir(hash) {
		return join(this.root, "projects", hash);
	}
	dailyFile(date) {
		return join(this.root, "daily", `${date}.md`);
	}
	/** 全量条目索引（缺失/损坏从空开始）。 */
	async readEntries() {
		const file = await readJson(this.entriesFile(), {
			version: 1,
			entries: []
		});
		return Array.isArray(file.entries) ? file.entries : [];
	}
	async writeEntries(entries) {
		await atomicWriteJson(this.entriesFile(), {
			version: 1,
			entries
		});
	}
	/**
	* entries.json 写串行队列：所有「读-改-写」操作必须经此队列执行，
	* 消除提取/注入命中刷新/API 裁决/每日编译之间的并发覆盖（read-modify-write 竞争）。
	*/
	writeQueue = Promise.resolve();
	enqueueWrite(task) {
		const result = this.writeQueue.then(task);
		this.writeQueue = result.then(() => void 0, () => void 0);
		return result;
	}
	/**
	* 原子化「读 entries → 修改 → 写回」。fn 原地修改传入数组（或返回替换数组）。
	* @param fn - 接收当前 entries 快照，修改或返回新数组；返回值透传。
	*/
	async mutateEntries(fn) {
		return this.enqueueWrite(async () => {
			const entries = await this.readEntries();
			const result = await fn(entries);
			await this.writeEntries(entries);
			return result;
		});
	}
	async getEntry(id) {
		return (await this.readEntries()).find((entry) => entry.id === id);
	}
	/**
	* 新增或更新（同 id 合并）。返回 { created, entry }。
	* 同时按去重逻辑：新增时若同内容（同 scope+projectHash）已存在则合并为 update。
	*/
	async upsertEntry(next) {
		return this.mutateEntries((entries) => {
			const id = entryIdOf(next.content, next.scope, next.projectHash);
			const existing = entries.find((entry) => entry.id === id);
			const now = nowIso();
			let entry;
			if (existing !== void 0) {
				entry = {
					...existing,
					content: next.content,
					tags: mergeTags(existing.tags, next.tags),
					pinned: next.pinned ?? existing.pinned,
					importance: Math.max(existing.importance, next.importance ?? existing.importance),
					layer: next.layer ?? existing.layer,
					updatedAt: now
				};
				entries.splice(entries.indexOf(existing), 1, entry);
				return {
					created: false,
					entry
				};
			}
			entry = {
				id,
				content: next.content,
				scope: next.scope,
				projectHash: next.scope === "project" ? next.projectHash : null,
				tags: next.tags ?? [],
				pinned: next.pinned ?? false,
				createdAt: now,
				updatedAt: now,
				importance: next.importance ?? 10,
				lastHitAt: null,
				layer: next.layer ?? "short",
				source: next.source ?? "extract"
			};
			entries.push(entry);
			return {
				created: true,
				entry
			};
		});
	}
	/** 替换单条（用于裁决操作：改标签/移项目/置顶）。返回新条目；不存在返回 undefined。 */
	async patchEntry(id, patch) {
		return this.mutateEntries((entries) => {
			const index = entries.findIndex((entry) => entry.id === id);
			if (index === -1) return void 0;
			const updated = {
				...entries[index],
				...patch,
				id,
				updatedAt: nowIso()
			};
			if (updated.scope === "global") updated.projectHash = null;
			entries[index] = updated;
			return updated;
		});
	}
	/** 删除条目。返回是否删除成功。 */
	async removeEntry(id) {
		return this.mutateEntries((entries) => {
			const index = entries.findIndex((entry) => entry.id === id);
			if (index === -1) return false;
			entries.splice(index, 1);
			return true;
		});
	}
	/** 注入命中刷新（原子）：给命中的条目加分并刷新 lastHitAt，返回刷新条数。 */
	async applyHits(hitIds, bonus) {
		return this.mutateEntries((entries) => {
			let count = 0;
			for (const entry of entries) {
				if (!hitIds.has(entry.id)) continue;
				entry.importance = Math.min(20, Math.round((entry.importance + bonus) * 100) / 100);
				entry.lastHitAt = nowIso();
				count += 1;
			}
			return count;
		});
	}
	/** 原子替换全部条目（ticker 每日编译等批量场景；fn 返回新数组）。 */
	async replaceEntries(fn) {
		return this.enqueueWrite(async () => {
			const next = await fn(await this.readEntries());
			await this.writeEntries(next);
			return next;
		});
	}
	async appendChange(change) {
		const record = {
			...change,
			id: `chg_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`,
			at: nowIso()
		};
		await appendJsonl(this.changesFile(localDate()), record);
		return record;
	}
	async readChanges(date) {
		if (date !== void 0) return readJsonl(this.changesFile(date));
		const dir = join(this.root, "changes");
		let files;
		try {
			files = await readdir(dir);
		} catch {
			return [];
		}
		const dates = files.filter((file) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(file)).sort();
		const all = [];
		for (const file of dates) all.push(...await readJsonl(join(dir, file)));
		return all;
	}
	/** 插件错误日志（追加模式，供崩溃排查；DSH 控制台日志不落盘）。 */
	async appendErrorLog(stage, message) {
		const { appendFile } = await import("node:fs/promises");
		const file = join(this.root, "log", "errors.log");
		await mkdir(join(file, ".."), { recursive: true });
		await appendFile(file, `[${nowIso()}] ${stage}: ${message}\n`, "utf8");
	}
	/** 提取诊断日志（追加模式：开始/结束/耗时/候选数，排查提取卡死）。 */
	async appendExtractLog(message) {
		const { appendFile } = await import("node:fs/promises");
		const file = join(this.root, "log", "extract.log");
		await mkdir(join(file, ".."), { recursive: true });
		await appendFile(file, `[${nowIso()}] ${message}\n`, "utf8");
	}
	async readState() {
		const state = await readJson(this.stateFile(), {
			schemaVersion: 1,
			perSession: {},
			lastDailyDate: null
		});
		if (state.perSession === void 0 || state.perSession === null) state.perSession = {};
		return state;
	}
	async writeState(state) {
		await atomicWriteJson(this.stateFile(), state);
	}
	/** 注入被关闭的会话 id（内存缓存；null = 未加载）。 */
	injectDisabledCache = null;
	async ensureInjectCache() {
		if (this.injectDisabledCache !== null) return this.injectDisabledCache;
		const state = await this.readState();
		this.injectDisabledCache = new Set(Array.isArray(state.injectDisabled) ? state.injectDisabled : []);
		return this.injectDisabledCache;
	}
	/** 该会话是否启用记忆注入（默认开启）。 */
	async isInjectEnabled(sessionId) {
		return !(await this.ensureInjectCache()).has(sessionId);
	}
	/** 设置该会话的记忆注入开关（持久化到 state.json，走写串行队列）。 */
	async setInjectEnabled(sessionId, enabled) {
		const cache = await this.ensureInjectCache();
		const next = new Set(cache);
		if (enabled) next.delete(sessionId);
		else next.add(sessionId);
		this.injectDisabledCache = next;
		await this.enqueueWrite(async () => {
			const state = await this.readState();
			state.injectDisabled = [...next];
			await this.writeState(state);
		});
	}
	async readProjectMeta(hash) {
		return await readJson(join(this.projectDir(hash), "meta.json"), null) ?? void 0;
	}
	async writeProjectMeta(hash, meta) {
		await atomicWriteJson(join(this.projectDir(hash), "meta.json"), meta);
	}
	/** 列出全部项目（含 meta 与统计）。 */
	async listProjects(entries) {
		const dir = join(this.root, "projects");
		let hashes;
		try {
			hashes = (await readdir(dir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
		} catch {
			hashes = [];
		}
		const projects = [];
		for (const hash of hashes) {
			const meta = await this.readProjectMeta(hash);
			if (meta === void 0) continue;
			const owned = entries.filter((entry) => entry.scope === "project" && entry.projectHash === hash);
			projects.push({
				hash,
				path: meta.path,
				alias: meta.alias,
				locked: meta.locked,
				entryCount: owned.length,
				pinnedCount: owned.filter((entry) => entry.pinned).length
			});
		}
		projects.sort((a, b) => a.path.localeCompare(b.path));
		return projects;
	}
	/**
	* 读取 DSH 工作区注册表（${DSH_HOME}/storages/workspace.json），容错返回空。
	* 用于让「尚无记忆的新工作区」也出现在面板项目列表（entryCount 0）。
	*/
	async listDshWorkspaces() {
		const table = (await readJson(join(process.env.DSH_HOME ?? join(homedir(), ".dsh"), "storages", "workspace.json"), {}))?.tables?.workspaces;
		if (typeof table !== "object" || table === null) return [];
		const out = [];
		for (const record of Object.values(table)) if (typeof record === "object" && record !== null && typeof record.path === "string" && record.path !== "") out.push({
			path: record.path,
			title: typeof record.title === "string" && record.title !== "" ? record.title : record.path
		});
		return out;
	}
	/** 写任意 md 产物（原子）。 */
	async writeArtifact(path, content) {
		await atomicWriteText(join(this.root, path), content);
	}
	/** 写项目层产物。 */
	async writeProjectArtifacts(hash, artifacts) {
		const dir = this.projectDir(hash);
		await mkdir(dir, { recursive: true });
		for (const [name, content] of Object.entries(artifacts)) {
			if (content === void 0) continue;
			await atomicWriteText(join(dir, `${name}.md`), content);
		}
	}
	/** 写全局层产物。 */
	async writeGlobalArtifacts(artifacts) {
		const dir = this.globalDir();
		await mkdir(dir, { recursive: true });
		for (const [name, content] of Object.entries(artifacts)) {
			if (content === void 0) continue;
			await atomicWriteText(join(dir, `${name}.md`), content);
		}
	}
};
/** 合并标签（保留旧标签 + 新标签，去重，上限 8）。 */
function mergeTags(existing, next, max = 8) {
	const out = [];
	for (const tag of [...existing, ...next ?? []]) {
		const t = String(tag).trim();
		if (t === "") continue;
		if (!out.includes(t)) out.push(t);
		if (out.length >= max) break;
	}
	return out;
}
/** 摘要（截断 80 字）。 */
function summarize(content, max = 80) {
	const flat = content.replace(/\s+/g, " ").trim();
	return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}
//#endregion
//#region src/memory/engine/scoring.ts
/** 衰减后的 importance（每天乘 (1 - λ)）。 */
function decayImportance(importance, days, lambda) {
	if (days <= 0) return importance;
	const decayed = importance * Math.pow(1 - lambda, days);
	return Math.round(decayed * 100) / 100;
}
/** 距离某时间的天数（不足 1 天按 0）。 */
function daysSince(iso, from = /* @__PURE__ */ new Date()) {
	if (iso === null) return 0;
	const time = Date.parse(iso);
	if (Number.isNaN(time)) return 0;
	return Math.max(0, Math.floor((from.getTime() - time) / 864e5));
}
/** 是否进入注入产物：pinned 无条件；否则 importance 达到阈值（仅短期层；长期层天然已沉淀）。 */
function isInjectionEligible(entry, threshold) {
	if (entry.pinned) return true;
	if (entry.layer === "long") return true;
	return entry.importance >= threshold;
}
/** 短期 → 长期沉淀判断：高价值或经时间检验。 */
function shouldPromote(entry, threshold) {
	if (entry.layer !== "short") return false;
	if (entry.importance >= threshold * 2) return true;
	if (daysSince(entry.updatedAt) >= 14 && entry.importance >= threshold) return true;
	return false;
}
/** 滚出窗口：超 60 天且 importance 低于阈值一半的短期条目直接删除。 */
function shouldEvict(entry, threshold) {
	if (entry.layer !== "short" || entry.pinned) return false;
	return daysSince(entry.updatedAt) >= 60 && entry.importance < threshold / 2;
}
/** 注入排序分：pinned 最高，其次 importance 降序。 */
function injectionRank(entry) {
	return entry.pinned ? Number.POSITIVE_INFINITY : entry.importance;
}
//#endregion
//#region src/memory/engine/compile.ts
/** 身份/偏好类标签。 */
const IDENTITY_TAGS = [
	"身份",
	"identity",
	"偏好",
	"preference",
	"风格",
	"style",
	"人格",
	"persona",
	"习惯",
	"habit"
];
/** 事实类标签。 */
const FACT_TAGS = [
	"事实",
	"fact",
	"信息",
	"info",
	"要点",
	"key",
	"背景",
	"context"
];
/** 按时间把条目分组。 */
function groupEntries(entries, now = /* @__PURE__ */ new Date()) {
	const groups = {
		today: [],
		week: [],
		earlier: [],
		longterm: []
	};
	const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
	for (const entry of entries) {
		if (entry.layer === "long") {
			groups.longterm.push(entry);
			continue;
		}
		const time = Date.parse(entry.updatedAt);
		if (Number.isNaN(time)) {
			groups.earlier.push(entry);
			continue;
		}
		const days = Math.floor((startOfDay - time) / 864e5);
		if (days <= 0) groups.today.push(entry);
		else if (days < 7) groups.week.push(entry);
		else groups.earlier.push(entry);
	}
	return groups;
}
/** 单条 md 行。 */
function entryLine(entry) {
	const tagText = entry.tags.length > 0 ? ` \`${entry.tags.join("` `")}\`` : "";
	const score = entry.importance >= 10 ? "" : ` [${entry.importance}]`;
	return `- ${entry.content.replace(/\n/g, " ")}${score}${tagText}`;
}
/** 渲染 timeline（短期分组 + 长期沉淀）。 */
function renderTimeline(entries) {
	const groups = groupEntries(entries);
	const lines = ["# 记忆时间线"];
	const pushGroup = (title, list) => {
		if (list.length === 0) return;
		lines.push(`\n## ${title}`);
		for (const entry of list) lines.push(entryLine(entry));
	};
	pushGroup("今天", groups.today);
	pushGroup("本周", groups.week);
	pushGroup("更早", groups.earlier);
	pushGroup("长期沉淀", groups.longterm);
	return lines.join("\n");
}
/** 渲染 identity（全局层身份/偏好条目）。 */
function renderIdentity(entries) {
	const lines = ["# 用户身份与偏好"];
	for (const entry of entries) lines.push(entryLine(entry));
	return lines.join("\n");
}
/** 渲染 facts。 */
function renderFacts(entries) {
	if (entries.length === 0) return "";
	const lines = ["# 事实"];
	for (const entry of entries) lines.push(entryLine(entry));
	return lines.join("\n");
}
/** 渲染 pinned。 */
function renderPinned(entries) {
	if (entries.length === 0) return "";
	const lines = ["# 置顶"];
	for (const entry of entries) lines.push(entryLine(entry));
	return lines.join("\n");
}
/** 身份/偏好判定。 */
function isIdentityEntry(entry) {
	return entry.scope === "global" && entry.tags.some((tag) => IDENTITY_TAGS.includes(tag.toLowerCase()));
}
/** 事实判定（非 identity、非 pinned 且带事实标签或高重要性）。 */
function isFactEntry(entry) {
	if (entry.pinned) return false;
	if (entry.tags.some((tag) => FACT_TAGS.includes(tag.toLowerCase()))) return true;
	return entry.importance >= 8;
}
/** 全局层编译产物。 */
function compileGlobalArtifacts(entries) {
	const identity = entries.filter(isIdentityEntry);
	const facts = entries.filter((entry) => entry.scope === "global" && !isIdentityEntry(entry) && isFactEntry(entry));
	const pinned = entries.filter((entry) => entry.scope === "global" && entry.pinned);
	return {
		identity: renderIdentity(identity),
		facts: renderFacts(facts),
		pinned: renderPinned(pinned)
	};
}
/** 项目层编译产物。 */
function compileProjectArtifacts(entries) {
	const facts = entries.filter((entry) => isFactEntry(entry) && !entry.pinned);
	const pinned = entries.filter((entry) => entry.pinned);
	return {
		memory: renderTimeline(entries),
		facts: renderFacts(facts),
		pinned: renderPinned(pinned)
	};
}
/** 每日日志（跨项目全局；openhanako 同款格式）。 */
function renderDaily(date, changes) {
	const lines = [`# ${date} 记忆日志`, ""];
	if (changes.length === 0) lines.push("（无新记忆）");
	else for (const change of changes) {
		const badge = change.action === "add" ? "新增" : change.action === "promote" ? "沉淀" : "更新";
		const scope = change.scope === "global" ? "全局" : "项目";
		lines.push(`- [${badge}][${scope}] ${change.summary}`);
	}
	return lines.join("\n");
}
/**
* 组装注入文本与 sections。
* @param entries - 注入可见条目（已按重要性排序）。
* @param config - 注入预算。
*/
function buildInjectionText(entries, config) {
	const budget = Math.max(1e3, config.injectTokenBudget);
	const sections = {
		identity: "",
		memory: "",
		pinned: "",
		facts: ""
	};
	const pinned = entries.filter((entry) => entry.pinned);
	const rest = entries.filter((entry) => !entry.pinned);
	let used = 0;
	const consume = (section, text) => {
		if (text === "") return;
		const block = `${`[${sectionHeader(section)}]`}\n${text}`;
		if (used + block.length > budget && section !== "pinned") return;
		if (section !== "pinned") used += block.length + 1;
		sections[section] = text;
	};
	if (pinned.length > 0) consume("pinned", renderPinned(pinned));
	for (const entry of rest) if (entry.scope === "global") {
		if (isIdentityEntry(entry)) {
			if (sections.identity === "") consume("identity", `- ${entry.content}`);
		} else if (sections.facts === "") consume("facts", `- ${entry.content}`);
	} else if (sections.memory === "") consume("memory", `- ${entry.content}`);
	return {
		text: [
			sections.identity,
			sections.memory,
			sections.pinned,
			sections.facts
		].filter(Boolean).join("\n\n"),
		sections: [
			sections.identity ? {
				name: "identity",
				text: sections.identity
			} : null,
			sections.memory ? {
				name: "memory",
				text: sections.memory
			} : null,
			sections.pinned ? {
				name: "pinned",
				text: sections.pinned
			} : null,
			sections.facts ? {
				name: "facts",
				text: sections.facts
			} : null
		].filter((section) => section !== null)
	};
}
function sectionHeader(section) {
	switch (section) {
		case "identity": return "记忆·身份偏好";
		case "memory": return "记忆·项目";
		case "pinned": return "记忆·置顶";
		case "facts": return "记忆·事实";
	}
}
/** 全量编译入口：写项目层 + 全局层产物（ticker 调用）。 */
async function compileAll(store, config) {
	const entries = await store.readEntries();
	const byProject = /* @__PURE__ */ new Map();
	for (const entry of entries) {
		if (entry.scope !== "project" || entry.projectHash === null) continue;
		const list = byProject.get(entry.projectHash) ?? [];
		list.push(entry);
		byProject.set(entry.projectHash, list);
	}
	for (const [hash, owned] of byProject) await store.writeProjectArtifacts(hash, compileProjectArtifacts(owned));
	const global = entries.filter((entry) => entry.scope === "global");
	await store.writeGlobalArtifacts(compileGlobalArtifacts(global));
}
/** 从 entries 中选注入可见条目（short 层按阈值过滤 + 排序）。 */
function selectInjectionEntries(entries, threshold) {
	return entries.filter((entry) => isInjectionEligible(entry, threshold)).sort((a, b) => injectionRank(b) - injectionRank(a));
}
/** 当前工作区项目 hash（会话 cwd 判定；取不到返回 null → 调用方回退 global）。 */
function workspaceHashOf(header) {
	const cwd = header?.cwd;
	if (typeof cwd !== "string" || cwd.trim() === "") return null;
	return projectHashOf(cwd);
}
/** 今日变更的 md 日志文本（写 daily）。 */
async function writeDailyLog(store, date = localDate()) {
	const summary = (await store.readChanges(date)).map((change) => ({
		action: change.action,
		summary: change.summary,
		scope: change.scope
	}));
	await store.writeArtifact(`daily/${date}.md`, renderDaily(date, summary));
}
/** 促进短期条目到长期层（每日编译时调用）。 */
function promoteEntries(entries, threshold) {
	const promoted = [];
	const remaining = [];
	for (const entry of entries) if (shouldPromote(entry, threshold)) promoted.push({
		...entry,
		layer: "long"
	});
	else remaining.push(entry);
	return {
		promoted,
		remaining
	};
}
//#endregion
//#region src/memory/api.ts
const ROUTE_PREFIX$1 = "/api/dsh-memory";
function toView$1(entry) {
	return {
		id: entry.id,
		content: entry.content,
		scope: entry.scope,
		projectHash: entry.projectHash,
		tags: entry.tags,
		pinned: entry.pinned,
		importance: entry.importance,
		layer: entry.layer,
		source: entry.source,
		createdAt: entry.createdAt,
		updatedAt: entry.updatedAt
	};
}
/** 挂载全部路由。 */
function mountMemoryRoutes(ctx, store, config) {
	return ctx.webServer.register({
		kind: "prefix",
		path: ROUTE_PREFIX$1,
		handler: (req, res) => {
			handle$1(ctx, store, config, req, res);
		}
	});
}
async function handle$1(ctx, store, config, req, res) {
	if (!loopbackAllowed$1(req)) {
		json$1(res, 403, { error: "loopback-only" });
		return;
	}
	let url;
	let rest;
	let method;
	try {
		url = new URL$1(req.url ?? "/", "http://localhost");
		rest = url.pathname.slice(15);
		method = req.method ?? "GET";
	} catch {
		json$1(res, 400, { error: "invalid request url" });
		return;
	}
	const apiStarted = Date.now();
	store.appendExtractLog(`api ${method} ${rest} start`).catch(() => void 0);
	try {
		if (method === "GET" && rest === "/list") {
			json$1(res, 200, await listView(store, url.searchParams));
			return;
		}
		if (method === "GET" && rest === "/projects") {
			const entries = await store.readEntries();
			json$1(res, 200, { projects: await mergeWorkspaces(store, await store.listProjects(entries)) });
			return;
		}
		if (method === "GET" && rest === "/tags") {
			const entries = await store.readEntries();
			const counts = /* @__PURE__ */ new Map();
			for (const entry of entries) for (const tag of entry.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
			json$1(res, 200, { tags: [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([tag, count]) => ({
				tag,
				count
			})) });
			return;
		}
		if (method === "GET" && rest === "/changes") {
			const date = url.searchParams.get("date") ?? localDate();
			json$1(res, 200, {
				date,
				changes: await store.readChanges(date)
			});
			return;
		}
		if (method === "GET" && rest === "/summary") {
			const entries = await store.readEntries();
			const today = localDate();
			json$1(res, 200, {
				today,
				entryCount: entries.length,
				projectCount: (await store.listProjects(entries)).length,
				todayChanges: (await store.readChanges(today)).length
			});
			return;
		}
		if (method === "GET" && rest === "/inject-state") {
			const sessionId = url.searchParams.get("sessionId") ?? "";
			json$1(res, 200, { enabled: await store.isInjectEnabled(sessionId) });
			return;
		}
		if (method === "POST" && rest === "/inject-state") {
			const body = await readBody$1(req);
			const sessionId = requireString(body.sessionId, "sessionId");
			const enabled = body.enabled !== false;
			await store.setInjectEnabled(sessionId, enabled);
			json$1(res, 200, {
				ok: true,
				enabled
			});
			return;
		}
		if (method === "POST" && rest === "/pin") {
			const body = await readBody$1(req);
			const entryId = requireString(body.entryId, "entryId");
			const pinned = body.pinned !== false;
			const entry = await store.patchEntry(entryId, { pinned });
			if (entry === void 0) throw new Error(`记忆不存在：${entryId}`);
			json$1(res, 200, {
				ok: true,
				entry: toView$1(entry)
			});
			return;
		}
		if (method === "POST" && rest === "/update") {
			const body = await readBody$1(req);
			const entryId = requireString(body.entryId, "entryId");
			const patch = {};
			if (typeof body.content === "string" && body.content.trim() !== "") patch.content = body.content.trim();
			if (Array.isArray(body.tags)) patch.tags = body.tags.filter((tag) => typeof tag === "string" && tag.trim() !== "").map((tag) => tag.trim()).slice(0, 8);
			const before = await store.getEntry(entryId);
			const entry = await store.patchEntry(entryId, patch);
			if (entry === void 0) throw new Error(`记忆不存在：${entryId}`);
			await store.appendChange({
				action: "update",
				entryId: entry.id,
				scope: entry.scope,
				projectHash: entry.projectHash,
				summary: summarize(entry.content),
				before: before?.content,
				after: entry.content
			});
			json$1(res, 200, {
				ok: true,
				entry: toView$1(entry)
			});
			return;
		}
		if (method === "POST" && rest === "/move") {
			const body = await readBody$1(req);
			const entryId = requireString(body.entryId, "entryId");
			const existing = await store.getEntry(entryId);
			if (existing === void 0) throw new Error(`记忆不存在：${entryId}`);
			let scope = existing.scope;
			let projectHash = existing.projectHash;
			if (body.scope === "global") {
				scope = "global";
				projectHash = null;
			} else if (body.scope === "project") {
				scope = "project";
				projectHash = typeof body.projectHash === "string" && body.projectHash !== "" ? body.projectHash : existing.projectHash;
				if (projectHash === null) throw new Error("移入项目需要 projectHash");
				if (await store.readProjectMeta(projectHash) === void 0) await store.writeProjectMeta(projectHash, {
					path: typeof body.path === "string" && body.path !== "" ? body.path : "手动归属",
					alias: null,
					locked: true
				});
			}
			const entry = await store.patchEntry(entryId, {
				scope,
				projectHash
			});
			if (entry === void 0) throw new Error(`记忆不存在：${entryId}`);
			await store.appendChange({
				action: "update",
				entryId: entry.id,
				scope: entry.scope,
				projectHash: entry.projectHash,
				summary: `移项目：${summarize(entry.content)}`,
				before: existing.content,
				after: entry.content
			});
			await compileAll(store, config);
			json$1(res, 200, {
				ok: true,
				entry: toView$1(entry)
			});
			return;
		}
		if (method === "POST" && rest === "/delete") {
			const entryId = requireString((await readBody$1(req)).entryId, "entryId");
			const existing = await store.getEntry(entryId);
			if (existing === void 0) {
				json$1(res, 200, {
					ok: true,
					alreadyGone: true
				});
				return;
			}
			if (!await store.removeEntry(entryId)) {
				json$1(res, 200, {
					ok: true,
					alreadyGone: true
				});
				return;
			}
			await store.appendChange({
				action: "delete",
				entryId,
				scope: existing.scope,
				projectHash: existing.projectHash,
				summary: `删除：${summarize(existing.content)}`
			});
			await compileAll(store, config);
			json$1(res, 200, { ok: true });
			return;
		}
		if (method === "POST" && rest === "/meta") {
			const body = await readBody$1(req);
			const hash = requireString(body.projectHash, "projectHash");
			const meta = await store.readProjectMeta(hash);
			const next = {
				path: meta?.path ?? (typeof body.path === "string" && body.path !== "" ? body.path : "手动归属"),
				alias: typeof body.alias === "string" && body.alias !== "" ? body.alias.slice(0, 64) : meta?.alias ?? null,
				locked: typeof body.locked === "boolean" ? body.locked : meta?.locked ?? true
			};
			await store.writeProjectMeta(hash, next);
			json$1(res, 200, {
				ok: true,
				meta: {
					...next,
					hash
				}
			});
			return;
		}
		if (method === "POST" && rest === "/delete-project") {
			const projectHash = requireString((await readBody$1(req)).projectHash, "projectHash");
			const removed = await store.mutateEntries((entries) => {
				const targets = entries.filter((entry) => entry.scope === "project" && entry.projectHash === projectHash);
				for (const target of targets) entries.splice(entries.indexOf(target), 1);
				return targets;
			});
			for (const entry of removed) await store.appendChange({
				action: "delete",
				entryId: entry.id,
				scope: entry.scope,
				projectHash: entry.projectHash,
				summary: `清空项目：${summarize(entry.content)}`
			});
			await compileAll(store, config);
			json$1(res, 200, {
				ok: true,
				deleted: removed.length
			});
			return;
		}
		if (method === "POST" && rest === "/remember") {
			const body = await readBody$1(req);
			const content = typeof body.content === "string" ? body.content.trim() : "";
			if (content === "") throw new Error("content 不能为空");
			const scope = body.scope === "global" ? "global" : "project";
			const projectHash = scope === "project" ? typeof body.projectHash === "string" && body.projectHash !== "" ? body.projectHash : null : null;
			if (scope === "project" && projectHash === null) throw new Error("项目层记忆需要 projectHash（当前无工作区，请用全局或指定项目）");
			const tags = Array.isArray(body.tags) ? body.tags.filter((tag) => typeof tag === "string" && tag.trim() !== "").map((tag) => tag.trim()).slice(0, 8) : [];
			const importance = typeof body.importance === "number" && Number.isFinite(body.importance) ? Math.max(1, Math.min(10, Math.round(body.importance))) : 8;
			const pinned = body.pinned === true;
			if (scope === "project" && projectHash !== null) {
				if (await store.readProjectMeta(projectHash) === void 0) await store.writeProjectMeta(projectHash, {
					path: typeof body.path === "string" && body.path !== "" ? body.path : "手动归属",
					alias: null,
					locked: false
				});
			}
			const beforeEntry = await store.getEntry(entryIdOf(content, scope, scope === "project" ? projectHash : null));
			const { created, entry } = await store.upsertEntry({
				content,
				scope,
				projectHash: scope === "project" ? projectHash : null,
				tags,
				importance,
				pinned,
				source: "manual"
			});
			await store.appendChange({
				action: created ? "add" : "update",
				entryId: entry.id,
				scope: entry.scope,
				projectHash: entry.projectHash,
				summary: summarize(entry.content),
				before: beforeEntry?.content,
				after: entry.content
			});
			await compileAll(store, config);
			json$1(res, 200, {
				ok: true,
				created,
				entry: toView$1(entry)
			});
			return;
		}
		json$1(res, 404, { error: `no route for ${method} ${rest}` });
	} catch (error) {
		json$1(res, 400, { error: error instanceof Error ? error.message : String(error) });
	} finally {
		store.appendExtractLog(`api ${method} ${rest} done ${Date.now() - apiStarted}ms`).catch(() => void 0);
	}
}
/** 面板列表视图（scope/项目/搜索/标签过滤）。 */
async function listView(store, params) {
	const entries = await store.readEntries();
	const scope = params.get("scope");
	const project = params.get("project");
	const q = params.get("q")?.trim().toLowerCase() ?? "";
	const tag = params.get("tag");
	return {
		entries: entries.filter((entry) => {
			if (scope === "global" && entry.scope !== "global") return false;
			if (scope === "project" && entry.scope !== "project") return false;
			if (project !== null && project !== "" && entry.projectHash !== project) return false;
			if (q !== "") {
				const haystack = `${entry.content} ${entry.tags.join(" ")}`.toLowerCase();
				if (!q.split(/\s+/).every((term) => haystack.includes(term))) return false;
			}
			if (tag !== null && tag !== "" && !entry.tags.includes(tag)) return false;
			return true;
		}).sort((a, b) => {
			if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
			return b.updatedAt.localeCompare(a.updatedAt);
		}).map(toView$1),
		projects: await mergeWorkspaces(store, await store.listProjects(entries))
	};
}
/**
* 合并 DSH 工作区注册表：尚无记忆的新工作区也出现在项目列表（entryCount 0），
* 让「刚建的工作区」在记忆面板立即可见（无需等第一条记忆写入）。
*/
async function mergeWorkspaces(store, projects) {
	const known = new Set(projects.map((project) => project.hash));
	for (const workspace of await store.listDshWorkspaces()) {
		const hash = projectHashOf(workspace.path);
		if (!known.has(hash)) {
			projects.push({
				hash,
				path: workspace.path,
				alias: workspace.title,
				locked: false,
				entryCount: 0,
				pinnedCount: 0
			});
			known.add(hash);
		}
	}
	projects.sort((a, b) => a.path.localeCompare(b.path));
	return projects;
}
function isLoopbackAddress$1(address) {
	if (typeof address !== "string") return false;
	const a = address.toLowerCase();
	if (a === "::1") return true;
	const octets = (a.startsWith("::ffff:") ? a.slice(7) : a).split(".");
	return octets.length === 4 && octets[0] === "127" && octets.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}
function hostNameOf$1(value) {
	if (typeof value !== "string") return null;
	const host = value.trim().toLowerCase();
	if (host.startsWith("[")) {
		const close = host.indexOf("]");
		if (close <= 1) return null;
		const suffix = host.slice(close + 1);
		if (suffix !== "" && !/^:\d+$/.test(suffix)) return null;
		return host.slice(1, close);
	}
	const firstColon = host.indexOf(":");
	if (firstColon !== host.lastIndexOf(":")) return null;
	return firstColon === -1 ? host : host.slice(0, firstColon);
}
function loopbackAllowed$1(req) {
	if (!isLoopbackAddress$1(req.socket.remoteAddress)) return false;
	const host = hostNameOf$1(req.headers.host);
	if (host === null) return false;
	return host === "localhost" || host === "127.0.0.1" || host === "::1";
}
function json$1(res, status, value) {
	const body = JSON.stringify(value);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-cache"
	});
	res.end(body);
}
function readBody$1(req) {
	return new Promise((resolvePromise, reject) => {
		const chunks = [];
		let size = 0;
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > 4 * 1024 * 1024) {
				reject(/* @__PURE__ */ new Error("request body too large"));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			if (chunks.length === 0) {
				resolvePromise({});
				return;
			}
			try {
				resolvePromise(JSON.parse(Buffer.concat(chunks).toString("utf8")));
			} catch (error) {
				reject(error instanceof Error ? error : /* @__PURE__ */ new Error("invalid JSON body"));
			}
		});
		req.on("error", reject);
	});
}
function requireString(value, name) {
	if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} 不能为空`);
	return value.trim();
}
//#endregion
//#region src/memory/engine/extract.ts
/**
* dsh-memory 提取引擎：turn/end 捕获的本轮对话增量窗口 → LLM 结构化提取候选。
* 输入是「增量窗口」（本 turn 的 user/assistant 文本），不重读整会话。
* LLM 失败/超时一律跳过本轮，绝不阻塞对话。
*/
/** 提取超时（毫秒）。 */
const EXTRACT_TIMEOUT_MS = 3e4;
/**
* 解析 LLM 输出为候选列表（容错：剥 fence / 去 BOM / 找最外层对象；失败返回 []）。
*/
function parseExtractOutput(raw) {
	let text = raw.trim();
	const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
	if (fence !== null) text = fence[1].trim();
	text = text.replace(/^\uFEFF/, "").trim();
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start === -1 || end <= start) return [];
	let parsed;
	try {
		parsed = JSON.parse(text.slice(start, end + 1));
	} catch {
		return [];
	}
	if (typeof parsed !== "object" || parsed === null) return [];
	const memories = parsed.memories;
	if (!Array.isArray(memories)) return [];
	const out = [];
	for (const item of memories) {
		if (typeof item !== "object" || item === null) continue;
		const record = item;
		const content = typeof record.content === "string" ? record.content.trim() : "";
		if (content === "") continue;
		const scope = record.scope === "global" ? "global" : "project";
		const tags = Array.isArray(record.tags) ? record.tags.filter((tag) => typeof tag === "string" && tag.trim() !== "").map((tag) => tag.trim()).slice(0, 8) : [];
		const importance = typeof record.importance === "number" && Number.isFinite(record.importance) ? Math.max(1, Math.min(10, Math.round(record.importance))) : 5;
		out.push({
			content,
			scope,
			tags,
			importance
		});
	}
	return out;
}
/** 提取 prompt：把「闲聊」与「值得记忆」分开，输出结构化 JSON。 */
function extractSystemPrompt() {
	return [
		"You are a memory extractor for an AI assistant. Read the conversation transcript and extract information worth remembering across sessions.",
		"Return ONLY a JSON object in this exact shape (no markdown, no commentary):",
		"{\"memories\":[{\"content\":\"...\",\"scope\":\"global\"|\"project\",\"tags\":[\"...\"],\"importance\":1}]}",
		"Rules:",
		"- Extract only durable facts, decisions, preferences, gotchas, project context, architecture notes, API details, and user identity that would help future sessions.",
		"- Skip small talk, greetings, chit-chat, and content with no lasting value.",
		"- scope: \"global\" for user identity/preferences/working style; \"project\" for workspace/project-specific content.",
		"- tags: 1-4 short category tags in the same language as the content (e.g. 技术, 踩坑, 架构, 偏好).",
		"- importance: integer 1-10; higher = more valuable to remember. Use 6+ for real facts, 8+ for critical decisions.",
		"- content: write in the original language of the conversation, one complete concise sentence or bullet.",
		"- NEVER extract project instruction files (AGENTS.md, CLAUDE.md), the skill catalog (available skills list), or any skill content: those are auto-injected by the harness and must NOT be stored as memory.",
		"- If nothing is worth remembering, return {\"memories\":[]}."
	].join("\n");
}
/** 组装提取请求的 user 消息（JSON 包裹转录文本，防结构性破坏）。 */
function extractUserPrompt(transcript) {
	return `Extract memories from this conversation transcript (JSON string):\n${JSON.stringify(transcript)}`;
}
/**
* 通过 DSH 现有模型通道提取候选。
* @returns 候选列表；任何失败返回 []（尽力而为的副产物）。
*/
async function extractCandidates(ctx, agent, transcript, config) {
	if (transcript.trim() === "") return [];
	const llm = ctx.get("llm");
	if (llm === void 0) return [];
	const route = await resolveRoute(ctx, agent);
	if (route === void 0) return [];
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), EXTRACT_TIMEOUT_MS);
	try {
		const options = {
			provider: route.provider,
			model: route.model,
			messages: [createUserMessage({
				content: [{
					type: "text",
					text: extractUserPrompt(transcript.slice(0, config.extractMaxChars))
				}],
				source: {
					kind: "plugin",
					plugin: "dsh-memory"
				}
			})],
			system: extractSystemPrompt(),
			maxTokens: 2048,
			signal: controller.signal
		};
		const assembler = new BlockAssembler();
		for await (const chunk of llm.stream(options)) assembler.push(chunk);
		if (assembler.finish.kind !== "stop") return [];
		return parseExtractOutput(assembler.blocks().filter((block) => block.type === "text" || block.type === "reasoning").map((block) => block.text ?? "").join(" ")).filter((candidate) => candidate.importance >= config.minImportance && !isSensitiveContent(candidate.content));
	} catch (error) {
		ctx.logger?.debug?.(`[dsh-memory] extract failed: ${error instanceof Error ? error.message : String(error)}`);
		return [];
	} finally {
		clearTimeout(timer);
	}
}
/** 敏感凭据模式（自动提取时命中即丢弃，防止密钥/token 入库）。 */
const SENSITIVE_PATTERNS = [
	/gh[pousr]_[A-Za-z0-9]{20,}/,
	/sk-[A-Za-z0-9_-]{20,}/i,
	/AKIA[0-9A-Z]{16}/,
	/xox[baprs]-[A-Za-z0-9-]{20,}/i,
	/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/i,
	/(?:password|passwd|secret|api[_-]?key|access[_-]?token|private[_-]?key)\s*[=:]\s*[^\s,，。；;]{8,}/i
];
/** 检测内容是否包含敏感凭据。 */
function isSensitiveContent(text) {
	return SENSITIVE_PATTERNS.some((pattern) => pattern.test(text));
}
/** 解析 LLM 路由：agent 显式配置优先，回退默认模型选择。 */
async function resolveRoute(ctx, agent) {
	if (agent.options.provider !== void 0 && agent.options.model !== void 0 && agent.options.provider !== "" && agent.options.model !== "") return {
		provider: agent.options.provider,
		model: agent.options.model
	};
	const defaultModel = ctx.get("agentDefaultModel");
	if (defaultModel !== void 0) try {
		const selection = defaultModel.currentSelection();
		if (selection.provider !== void 0 && selection.model !== void 0) return {
			provider: selection.provider,
			model: selection.model
		};
	} catch {}
}
/** 从事件流维护的 turn 缓冲里取文本（extract 输入）。 */
function transcriptFromEvents(events) {
	const lines = [];
	for (const event of events) if (event.type === "user/message") {
		const message = event.data;
		if (typeof message.source?.kind === "string" && [
			"plugin",
			"agent-instructions",
			"skill-catalog",
			"skill-invocation"
		].includes(message.source.kind)) continue;
		lines.push(`User: ${textOfContent(message.content)}`);
	} else if (event.type === "assistant/message") {
		const data = event.data;
		lines.push(`Assistant: ${textOfContent(data.message?.content)}`);
	}
	return lines.join("\n");
}
/** 把 ContentBlock[] 或字符串平铺为文本。 */
function textOfContent(content) {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts = [];
	for (const block of content) {
		if (typeof block !== "object" || block === null) continue;
		const record = block;
		if (record.type === "text" && typeof record.text === "string") parts.push(record.text);
	}
	return parts.join("\n").trim();
}
//#endregion
//#region src/memory/engine/inject.ts
/**
* dsh-memory 注入引擎：agent/pre-step 把「全局 identity + 当前项目 memory +
* pinned + facts」组装为一条带来源的 user message 注入（source: { kind: 'plugin' }）。
* 绝不写 system prompt（DSH persona complete:true 会静默丢弃）；
* 只注入当前工作区项目 + 全局层；token 超预算按重要性截断，最低保留置顶。
* 命中刷新：被注入的条目距上次命中 ≥1 天时刷新 lastHitAt 并加分。
*/
/** 每次注入最多刷新的命中条目数。 */
const MAX_HITS_PER_INJECTION = 5;
/**
* 内置安全规范（每次注入都携带）：敏感凭据严禁提交/更新到 GitHub。
* 与提取敏感过滤、面板风险提示共同构成凭据防线。
*/
const SAFETY_RULE = [
	"【安全规范】所有 GitHub/OpenAI/AWS/Slack token、私钥、password 等敏感凭据",
	"严禁提交或更新到 GitHub 仓库；代码中一律用环境变量引用，",
	"并确保 .gitignore 排除含凭据的文件。"
].join("");
/** 创建注入器。 */
function createMemoryInjector(store, config, logger) {
	/** 每会话 step 计数（仅内存）。 */
	const stepCounters = /* @__PURE__ */ new Map();
	async function buildMemoryBlock(agent) {
		const entries = await store.readEntries();
		const hash = workspaceHashOf(agent.session.header);
		const visible = entries.filter((entry) => entry.scope === "global" || entry.scope === "project" && entry.projectHash === hash);
		if (visible.length === 0) return null;
		const selected = selectInjectionEntries(visible, config.compileThreshold);
		if (selected.length === 0) return null;
		const hitCandidates = selected.filter((entry) => entry.lastHitAt === null || daysSince(entry.lastHitAt) >= 1).slice(0, MAX_HITS_PER_INJECTION);
		if (hitCandidates.length > 0) {
			const hitIds = new Set(hitCandidates.map((entry) => entry.id));
			const refreshed = await store.applyHits(hitIds, config.hitBonus);
			logger?.debug?.(`[dsh-memory] hit refresh: ${refreshed} entries`);
		}
		return buildInjectionText(selected, config);
	}
	const preStepListener = async (payload, next) => {
		let decision;
		try {
			decision = await next();
		} catch (error) {
			logger?.warn?.(`[dsh-memory] pre-step next() failed: ${error instanceof Error ? error.message : String(error)}`);
			return { kind: "reject" };
		}
		if (decision.kind !== "enter" || payload.signal.aborted) return decision;
		const sessionId = payload.agent.session.id;
		if (!await store.isInjectEnabled(sessionId)) return decision;
		if (stepCounters.has(sessionId)) return decision;
		stepCounters.set(sessionId, 1);
		try {
			const block = await buildMemoryBlock(payload.agent);
			if (block === null || block.text === "") return decision;
			const memoryMessage = createUserMessage({
				content: [{
					type: "text",
					text: [
						SAFETY_RULE,
						"【长期记忆 · 用户要求按需执行或参考】",
						"（若与当前项目的 AGENTS.md / 项目指令或系统提示冲突，一律以项目指令为准；记忆仅作参考与用户偏好补充）",
						block.text
					].join("\n")
				}],
				source: {
					kind: "plugin",
					plugin: "dsh-memory",
					form: "snapshot",
					sections: [{
						name: "安全规范",
						text: SAFETY_RULE
					}, ...block.sections]
				}
			});
			return {
				kind: "enter",
				messages: [...decision.messages, memoryMessage]
			};
		} catch (error) {
			logger?.warn?.(`[dsh-memory] injection failed: ${error instanceof Error ? error.message : String(error)}`);
			return decision;
		}
	};
	return {
		preStepListener,
		disposeSession: (sessionId) => {
			stepCounters.delete(sessionId);
		}
	};
}
//#endregion
//#region src/memory/engine/ticker.ts
/** 会话结束判定静默期（毫秒）。 */
const SESSION_END_DEBOUNCE_MS = 15e3;
/** 每日检查定时器间隔（毫秒，仅兜底；正常由 turn/end 驱动）。 */
const DAILY_CHECK_INTERVAL_MS = 3600 * 1e3;
/**
* 创建 ticker。返回 { onTurnEnd, enqueue, dispose }。
* onTurnEnd 由 session/event 的 turn/end 分支调用；enqueue 供提取等写操作
* 共用同一条串行队列（内存锁：避免 ticker 与捕获并发读写同一 store）。
*/
function createTicker(ctx, store, config) {
	let queue = Promise.resolve();
	const enqueue = (task) => {
		const result = queue.then(task);
		queue = result.then(() => void 0, () => void 0);
		return result;
	};
	const enqueueSafe = (task) => {
		enqueue(task).catch((error) => {
			ctx.logger?.warn?.(`[dsh-memory] ticker task failed: ${error instanceof Error ? error.message : String(error)}`);
		});
	};
	/** 每会话的 final 编译 debounce 计时器。 */
	const sessionEndTimers = /* @__PURE__ */ new Map();
	/** 每日编译（幂等：lastDailyDate 前置判断，避免同日重复）。 */
	async function runDailyCompile() {
		const today = localDate();
		const state = await store.readState();
		const last = state.lastDailyDate;
		state.lastDailyDate = today;
		await store.writeState(state);
		if (last === today) return;
		const days = last === null ? 1 : Math.max(1, Math.floor((Date.parse(today) - Date.parse(last)) / 864e5));
		let promoted = [];
		let evicted = [];
		await store.replaceEntries((entries) => {
			const result = promoteEntries(entries.map((entry) => ({
				...entry,
				importance: decayImportance(entry.importance, days, config.decayLambda)
			})), config.compileThreshold);
			promoted = result.promoted;
			const kept = [];
			evicted = [];
			for (const entry of result.remaining) if (shouldEvict(entry, config.compileThreshold)) evicted.push(entry);
			else kept.push(entry);
			return [...promoted, ...kept];
		});
		for (const entry of promoted) await store.appendChange({
			action: "promote",
			entryId: entry.id,
			scope: entry.scope,
			projectHash: entry.projectHash,
			summary: summarize(entry.content)
		});
		for (const entry of evicted) await store.appendChange({
			action: "delete",
			entryId: entry.id,
			scope: entry.scope,
			projectHash: entry.projectHash,
			summary: `低分条目滚出：${summarize(entry.content)}`
		});
		await compileAll(store, config);
		await writeDailyLog(store);
		ctx.logger?.debug?.(`[dsh-memory] daily compile done (promoted=${promoted.length}, evicted=${evicted.length})`);
	}
	/** 每 N 轮增量编译（timeline 重写）。 */
	async function runTurnCompile(sessionId, turnCount) {
		if (turnCount % config.compileEveryTurns !== 0) return;
		await compileAll(store, config);
		ctx.logger?.debug?.(`[dsh-memory] incremental compile (session=${sessionId}, turns=${turnCount})`);
	}
	/** 会话结束 final 编译（debounce）。 */
	function scheduleSessionEnd(sessionId) {
		const existing = sessionEndTimers.get(sessionId);
		if (existing !== void 0) clearTimeout(existing);
		const timer = setTimeout(() => {
			sessionEndTimers.delete(sessionId);
			enqueueSafe(async () => {
				await compileAll(store, config);
				await writeDailyLog(store);
				ctx.logger?.debug?.(`[dsh-memory] final compile (session=${sessionId})`);
			});
		}, SESSION_END_DEBOUNCE_MS);
		sessionEndTimers.set(sessionId, timer);
	}
	/** turn/end 统一入口（返回排队任务的 promise，供调用方串行衔接）。 */
	function onTurnEnd(sessionId, _agent) {
		const result = enqueue(async () => {
			const state = await store.readState();
			const per = state.perSession[sessionId] ?? {
				turnCount: 0,
				lastInjectedStep: 0
			};
			per.turnCount += 1;
			state.perSession[sessionId] = per;
			const today = localDate();
			if (state.lastDailyDate !== today) {
				await store.writeState(state);
				if (config.dailyCompileEnabled) await runDailyCompile();
			} else await store.writeState(state);
			await runTurnCompile(sessionId, per.turnCount);
		});
		scheduleSessionEnd(sessionId);
		return result;
	}
	const checkInterval = ctx.get("timer")?.interval(() => {
		enqueueSafe(async () => {
			const state = await store.readState();
			const today = localDate();
			if (state.lastDailyDate !== today && config.dailyCompileEnabled) await runDailyCompile();
		});
	}, DAILY_CHECK_INTERVAL_MS);
	function dispose() {
		if (typeof checkInterval === "function") checkInterval();
		for (const timer of sessionEndTimers.values()) clearTimeout(timer);
		sessionEndTimers.clear();
	}
	return {
		onTurnEnd,
		enqueue,
		dispose
	};
}
//#endregion
//#region src/memory/tools.ts
/**
* dsh-memory 模型工具：AI 在对话中可主动调用的记忆操作。
* memory_search / memory_remember / memory_pin / memory_tag / memory_forget。
* 全部经 @deepseek-ai/dsh-tools 的 defineTool 注册，输出为模型可见文本。
*/
function toView(entry) {
	return {
		id: entry.id,
		content: entry.content,
		scope: entry.scope,
		projectHash: entry.projectHash,
		tags: entry.tags,
		pinned: entry.pinned,
		importance: entry.importance,
		layer: entry.layer,
		updatedAt: entry.updatedAt
	};
}
/** 文本匹配：query 的每个非空词都命中 content 或 tags。 */
function matchesQuery(entry, query) {
	const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (terms.length === 0) return true;
	const haystack = `${entry.content} ${entry.tags.join(" ")}`.toLowerCase();
	return terms.every((term) => haystack.includes(term));
}
/** 排序：pinned 优先，importance 降序，updatedAt 降序。 */
function rank(a, b) {
	if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
	if (a.importance !== b.importance) return b.importance - a.importance;
	return b.updatedAt.localeCompare(a.updatedAt);
}
/** 注册全部记忆工具，返回合并 disposer。 */
function registerMemoryTools(ctx, store, _config) {
	const disposers = [];
	disposers.push(ctx.tools.register(textTool({
		name: "memory_search",
		description: "搜索本地长期记忆（按内容/标签/项目）。用之前记住的决定、偏好、踩坑、项目上下文，或回答\"我记得/之前说过\"类问题时。",
		parameters: {
			query: {
				type: "string",
				description: "搜索关键词（空格分隔多个词，全部命中才返回）。留空列出全部。"
			},
			scope: {
				type: "string",
				enum: ["global", "project"],
				description: "global=全局层（身份/偏好）；project=项目层。默认全部。"
			},
			project: {
				type: "string",
				description: "项目标识（workspace 路径或 hash）。默认当前工作区项目。"
			},
			tag: {
				type: "string",
				description: "按标签筛选。"
			},
			limit: {
				type: "integer",
				description: "返回条数上限（默认 10，最大 30）。"
			}
		},
		async execute(args, exec) {
			const entries = await store.readEntries();
			const agent = exec.agent;
			const currentHash = agent !== void 0 ? workspaceHashOf(agent.session.header) : null;
			const projectFilter = typeof args.project === "string" && args.project !== "" ? resolveProjectFilter(args.project) : currentHash;
			const views = entries.map(toView).filter((view) => {
				if (view.scope === "project" && projectFilter !== null && view.projectHash !== projectFilter) return false;
				if (typeof args.scope === "string" && view.scope !== args.scope) return false;
				if (typeof args.tag === "string" && args.tag !== "" && !view.tags.includes(args.tag)) return false;
				if (typeof args.query === "string" && !matchesQuery(view, args.query)) return false;
				return true;
			}).sort(rank);
			const limit = Math.max(1, Math.min(30, typeof args.limit === "number" ? args.limit : 10));
			const picked = views.slice(0, limit);
			if (picked.length === 0) return "没有找到匹配的记忆。";
			return picked.map((view) => {
				const head = view.pinned ? "📌" : "";
				const scope = view.scope === "global" ? "全局" : "项目";
				const tags = view.tags.length > 0 ? ` [${view.tags.join(", ")}]` : "";
				const layer = view.layer === "long" ? "（长期）" : "";
				return `${head}[${view.importance}] ${scope}${layer}: ${view.content}${tags}`;
			}).join("\n");
		}
	})));
	disposers.push(ctx.tools.register(textTool({
		name: "memory_remember",
		description: "手动写入一条长期记忆（用户明确要求记住，或你判断值得跨会话保留的重要事实/决定）。",
		parameters: {
			content: {
				type: "string",
				required: true,
				description: "要记住的内容。"
			},
			scope: {
				type: "string",
				enum: ["global", "project"],
				description: "global=全局层（身份/偏好）；project=当前项目层。默认 project。"
			},
			tags: {
				type: "array",
				items: { type: "string" },
				description: "分类标签（如 技术、踩坑、架构、偏好）。"
			},
			importance: {
				type: "integer",
				description: "重要性 1-10（默认 8）。"
			}
		},
		async execute(args, exec) {
			const content = String(args.content ?? "").trim();
			if (content === "") throw new Error("content 不能为空");
			const agent = exec.agent;
			const hash = agent !== void 0 ? workspaceHashOf(agent.session.header) : null;
			const scope = args.scope === "global" ? "global" : "project";
			if (scope === "project" && hash === null) throw new Error("无法判定当前工作区项目（无 cwd），请用 scope: \"global\" 或稍后重试");
			const importance = typeof args.importance === "number" ? Math.max(1, Math.min(10, args.importance)) : 8;
			const tags = Array.isArray(args.tags) ? args.tags.filter((tag) => typeof tag === "string" && tag.trim() !== "").map((tag) => tag.trim()).slice(0, 8) : [];
			const { created, entry } = await store.upsertEntry({
				content,
				scope,
				projectHash: scope === "project" ? hash : null,
				tags,
				importance,
				source: "manual"
			});
			if (scope === "project" && hash !== null) {
				if (await store.readProjectMeta(hash) === void 0) await store.writeProjectMeta(hash, {
					path: agent?.session.header?.cwd ?? "手动记忆",
					alias: null,
					locked: false
				});
			}
			await store.appendChange({
				action: created ? "add" : "update",
				entryId: entry.id,
				scope: entry.scope,
				projectHash: entry.projectHash,
				summary: summarize(entry.content)
			});
			return created ? `已记住：${entry.content}（${scope === "global" ? "全局" : "项目"}${tags.length > 0 ? `，标签：${tags.join(", ")}` : ""}）` : `已更新记忆：${entry.content}`;
		}
	})));
	disposers.push(ctx.tools.register(textTool({
		name: "memory_pin",
		description: "置顶/取消置顶一条记忆（置顶的记忆始终进入上下文注入并显示在置顶区）。",
		parameters: {
			entryId: {
				type: "string",
				required: true,
				description: "记忆条目 id（用 memory_search 获取）。"
			},
			pinned: {
				type: "boolean",
				description: "true=置顶，false=取消。默认 true。"
			}
		},
		async execute(args) {
			const id = String(args.entryId ?? "");
			if (id === "") throw new Error("entryId 不能为空");
			const entry = await store.patchEntry(id, { pinned: args.pinned !== false });
			if (entry === void 0) throw new Error(`记忆不存在：${id}`);
			return entry.pinned ? `已置顶：${summarize(entry.content)}` : `已取消置顶：${summarize(entry.content)}`;
		}
	})));
	disposers.push(ctx.tools.register(textTool({
		name: "memory_tag",
		description: "修改一条记忆的标签（覆盖式更新标签列表）。",
		parameters: {
			entryId: {
				type: "string",
				required: true,
				description: "记忆条目 id。"
			},
			tags: {
				type: "array",
				items: { type: "string" },
				required: true,
				description: "新的标签列表（覆盖旧的）。"
			}
		},
		async execute(args) {
			const id = String(args.entryId ?? "");
			const tags = Array.isArray(args.tags) ? args.tags.filter((tag) => typeof tag === "string" && tag.trim() !== "").map((tag) => tag.trim()).slice(0, 8) : [];
			const entry = await store.patchEntry(id, { tags });
			if (entry === void 0) throw new Error(`记忆不存在：${id}`);
			await store.appendChange({
				action: "update",
				entryId: entry.id,
				scope: entry.scope,
				projectHash: entry.projectHash,
				summary: `改标签：${summarize(entry.content)}`
			});
			return `标签已更新：${entry.tags.length > 0 ? entry.tags.join(", ") : "（无）"}`;
		}
	})));
	disposers.push(ctx.tools.register(textTool({
		name: "memory_forget",
		description: "删除一条记忆（仅当用户明确要求删除/遗忘某条记忆时使用）。",
		parameters: { entryId: {
			type: "string",
			required: true,
			description: "记忆条目 id（用 memory_search 获取）。"
		} },
		async execute(args) {
			const id = String(args.entryId ?? "");
			if (id === "") throw new Error("entryId 不能为空");
			const entry = await store.getEntry(id);
			if (entry === void 0) throw new Error(`记忆不存在：${id}`);
			if (!await store.removeEntry(id)) throw new Error(`记忆不存在：${id}`);
			await store.appendChange({
				action: "delete",
				entryId: id,
				scope: entry.scope,
				projectHash: entry.projectHash,
				summary: `删除：${summarize(entry.content)}`
			});
			return `已删除记忆：${summarize(entry.content)}`;
		}
	})));
	return () => {
		for (const dispose of disposers) dispose();
	};
}
/** 按路径或 hash 解析项目筛选；解析失败返回 null（不筛）。 */
function resolveProjectFilter(project) {
	const trimmed = project.trim();
	if (trimmed === "") return null;
	if (/^[0-9a-f]{12}$/.test(trimmed)) return trimmed;
	return projectHashOf(trimmed);
}
/** 工具展示身份。 */
const TOOL_PRESENTATION = {
	memory_search: {
		kind: "read",
		title: (args) => `记忆搜索：${String(args.query ?? "")}`
	},
	memory_remember: {
		kind: "other",
		title: () => "记录记忆"
	},
	memory_pin: {
		kind: "other",
		title: (args) => `置顶：${String(args.entryId ?? "")}`
	},
	memory_tag: {
		kind: "other",
		title: (args) => `改标签：${String(args.entryId ?? "")}`
	},
	memory_forget: {
		kind: "other",
		title: (args) => `删除：${String(args.entryId ?? "")}`
	}
};
/** 文本工具包装（openviking 同款模式，泛型保留参数推断）。 */
function textTool(definition) {
	const presentation = TOOL_PRESENTATION[definition.name];
	return defineTool({
		...definition,
		output: {
			schema: { type: "string" },
			render: (_args, value) => [{
				type: "text",
				text: value
			}]
		},
		presentCall: (args) => ({
			card: "generic",
			kind: presentation.kind,
			title: presentation.title(args),
			rawInput: args
		})
	});
}
//#endregion
//#region src/memory/types.ts
/** 默认配置。 */
const DEFAULT_CONFIG = {
	extractEveryTurns: 1,
	compileEveryTurns: 10,
	compileThreshold: 4.5,
	decayLambda: .02,
	hitBonus: 2,
	injectTokenBudget: 6e3,
	injectRefreshSteps: 8,
	dailyCompileEnabled: true,
	extractMaxChars: 6e3,
	minImportance: 6
};
//#endregion
//#region src/memory/index.ts
/** 解析插件配置（cordis.patch.yml config 覆盖默认）。 */
function resolveConfig(input) {
	const config = { ...DEFAULT_CONFIG };
	if (input === void 0 || typeof input !== "object") return config;
	const candidate = input;
	for (const key of [
		"extractEveryTurns",
		"compileEveryTurns",
		"compileThreshold",
		"decayLambda",
		"hitBonus",
		"injectTokenBudget",
		"injectRefreshSteps",
		"extractMaxChars",
		"minImportance"
	]) {
		const value = candidate[key];
		if (typeof value === "number" && Number.isFinite(value) && value > 0) config[key] = value;
	}
	if (typeof candidate.dailyCompileEnabled === "boolean") config.dailyCompileEnabled = candidate.dailyCompileEnabled;
	return config;
}
/** 应用入口。 */
function applyMemory(ctx, input) {
	const config = resolveConfig(input);
	const store = new MemoryStore();
	const logError = (stage, error) => {
		const message = error instanceof Error ? error.stack ?? error.message : String(error);
		ctx.logger?.warn?.(`[dsh-memory] ${stage}: ${message}`);
		store.appendErrorLog(stage, message).catch(() => void 0);
	};
	function uncaughtListener(error) {
		logError("uncaughtException", error);
	}
	function unhandledListener(reason) {
		logError("unhandledRejection", reason);
	}
	process.on("uncaughtException", uncaughtListener);
	process.on("unhandledRejection", unhandledListener);
	ctx.effect(() => () => {
		process.removeListener("uncaughtException", uncaughtListener);
		process.removeListener("unhandledRejection", unhandledListener);
	}, "dsh-memory: process error hooks");
	const ticker = createTicker(ctx, store, config);
	ctx.effect(() => ticker.dispose, "dsh-memory: ticker");
	const injector = createMemoryInjector(store, config, ctx.logger);
	ctx.on("agent/pre-step", ((payload, next) => injector.preStepListener(payload, next)), { prepend: true });
	ctx.on("agent/disposed", ({ agent }) => {
		injector.disposeSession(agent.session.id);
	});
	const toolsDispose = registerMemoryTools(ctx, store, config);
	ctx.effect(() => toolsDispose, "dsh-memory: tools");
	const routesDispose = mountMemoryRoutes(ctx, store, config);
	ctx.effect(() => routesDispose, "dsh-memory: routes");
	const turnBuffers = /* @__PURE__ */ new Map();
	ctx.on("session/event", (session, event) => {
		if (event.type === "turn/start") {
			turnBuffers.set(session.id, []);
			return;
		}
		if (event.type === "turn/end") {
			const buffer = turnBuffers.get(session.id) ?? [];
			turnBuffers.delete(session.id);
			const turnNumber = event.data.turn ?? 0;
			ticker.onTurnEnd(session.id, { id: session.id }).catch((error) => logError("ticker.onTurnEnd", error));
			const agent = ctx.get("agents")?.get(session.id);
			if (agent === void 0) return;
			ticker.enqueue(async () => {
				await extractTurn(ctx, store, config, agent, buffer, turnNumber);
			}).catch((error) => logError("extractTurn", error));
			return;
		}
		if (event.type === "user/message" || event.type === "assistant/message") {
			const buffer = turnBuffers.get(session.id);
			if (buffer === void 0) return;
			buffer.push({
				type: event.type,
				data: event.data
			});
		}
	});
	ctx.logger?.info?.("[dsh-memory] memory engine mounted");
}
/** 一轮的提取与入库（提取频率由 extractEveryTurns 控制）。 */
async function extractTurn(ctx, store, config, agent, buffer, turnNumber) {
	const transcript = transcriptFromEvents(buffer);
	if (transcript.trim() === "") return;
	if (config.extractEveryTurns > 1 && turnNumber % config.extractEveryTurns !== 1) return;
	if (((await store.readState()).perSession[agent.id]?.extractFailStreak ?? 0) >= 3 && turnNumber % 10 !== 1) return;
	const startedAt = Date.now();
	store.appendExtractLog(`turn=${turnNumber} chars=${transcript.length} route=${agent.options.provider ?? "default"} start`);
	const candidates = await extractCandidates(ctx, agent, transcript, config);
	store.appendExtractLog(`turn=${turnNumber} done ${Date.now() - startedAt}ms candidates=${candidates.length}`);
	ctx.logger?.debug?.(`[dsh-memory] extract turn=${turnNumber} chars=${transcript.length} candidates=${candidates.length} route=${agent.options.provider ?? "default"}`);
	if (candidates.length === 0) {
		const latest = await store.readState();
		const per = latest.perSession[agent.id] ?? {
			turnCount: 0,
			lastInjectedStep: 0
		};
		per.extractFailStreak = (per.extractFailStreak ?? 0) + 1;
		latest.perSession[agent.id] = per;
		await store.writeState(latest);
		return;
	}
	let added = 0;
	let updated = 0;
	for (const candidate of candidates) {
		let scope = candidate.scope;
		let hash = null;
		if (scope === "project") {
			hash = workspaceHashOf(agent.session.header);
			if (hash === null) scope = "global";
		}
		const beforeEntry = await store.getEntry(entryIdOf(candidate.content, scope, hash));
		const { created, entry } = await store.upsertEntry({
			content: candidate.content,
			scope,
			projectHash: hash,
			tags: candidate.tags,
			importance: candidate.importance,
			source: "extract"
		});
		if (scope === "project" && hash !== null) {
			if (await store.readProjectMeta(hash) === void 0) await store.writeProjectMeta(hash, {
				path: agent.session.header?.cwd ?? "未知工作区",
				alias: null,
				locked: false
			});
		}
		if (created) added += 1;
		else updated += 1;
		await store.appendChange({
			action: created ? "add" : "update",
			entryId: entry.id,
			scope: entry.scope,
			projectHash: entry.projectHash,
			summary: summarize(entry.content),
			before: beforeEntry?.content,
			after: entry.content
		});
	}
	const successState = await store.readState();
	const successPer = successState.perSession[agent.id] ?? {
		turnCount: 0,
		lastInjectedStep: 0
	};
	successPer.extractFailStreak = 0;
	successState.perSession[agent.id] = successPer;
	await store.writeState(successState);
	if (added + updated > 0) {
		await compileAll(store, config);
		ctx.logger?.debug?.(`[dsh-memory] extracted ${added} new, ${updated} updated`);
	}
}
//#endregion
//#region src/file-explorer.ts
/**
* 工作区文件浏览器（自 dsh-file-explorer 合并）：挂 /api/file-explorer 路由，
* 提供工作区文件列表/读取/写入。所有文件 IO 走 `ctx.fs`，工作区根来自
* `ctx.workspaceRegistry`。安全：loopback-only + 工作区根 containment。
*
* Routes (all under /api/file-explorer):
*   GET /workspaces           → [{ id, title, path }]
*   GET /list?path=<dir>      → [{ name, type, size }]  (directories first)
*   GET /read?path=<file>     → { content, version, path }
*   PUT /write  { path, content, version? } → { version, operation }
*/
/** ── Constants ─────────────────────────────────────────────────────────── */
const ROUTE_PREFIX = "/api/file-explorer";
/** Text preview ceiling; larger files are refused rather than read whole. */
const MAX_READ_BYTES = 2 * 1024 * 1024;
/** Write body ceiling (JSON-escaped content can inflate ~2x). */
const MAX_BODY_BYTES = 16 * 1024 * 1024;
/** ── Errors ────────────────────────────────────────────────────────────── */
/** A deliberate HTTP failure with a chosen status. */
var HttpError = class extends Error {
	status;
	constructor(status, message) {
		super(message);
		this.status = status;
		this.name = "HttpError";
	}
};
/** Map an fs error's stable code to an HTTP status; unknown → 400. */
function fsErrorStatus(error) {
	switch (error.code) {
		case "FS_NOT_FOUND": return 404;
		case "FS_STALE_VERSION": return 409;
		case "FS_TOO_LARGE": return 413;
		case "FS_NOT_TEXT": return 415;
		case "FS_PERMISSION_DENIED":
		case "FS_SANDBOX_DENIED": return 403;
		default: return 400;
	}
}
/** ── Loopback fence (same contract as dsh-skill-manager) ───────────────── */
function isLoopbackAddress(address) {
	if (typeof address !== "string") return false;
	const a = address.toLowerCase();
	if (a === "::1") return true;
	const octets = (a.startsWith("::ffff:") ? a.slice(7) : a).split(".");
	return octets.length === 4 && octets[0] === "127" && octets.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}
function hostNameOf(value) {
	if (typeof value !== "string") return null;
	const host = value.trim().toLowerCase();
	if (host.startsWith("[")) {
		const close = host.indexOf("]");
		if (close <= 1) return null;
		const suffix = host.slice(close + 1);
		if (suffix !== "" && !/^:\d+$/.test(suffix)) return null;
		return host.slice(1, close);
	}
	const firstColon = host.indexOf(":");
	if (firstColon !== host.lastIndexOf(":")) return null;
	return firstColon === -1 ? host : host.slice(0, firstColon);
}
function loopbackAllowed(req) {
	if (!isLoopbackAddress(req.socket.remoteAddress)) return false;
	const host = hostNameOf(req.headers.host);
	if (host === null) return false;
	return host === "localhost" || host === "127.0.0.1" || host === "::1";
}
/** ── HTTP plumbing ─────────────────────────────────────────────────────── */
function json(res, status, value) {
	const body = JSON.stringify(value);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-cache"
	});
	res.end(body);
}
function readBody(req) {
	return new Promise((resolvePromise, reject) => {
		const chunks = [];
		let size = 0;
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > MAX_BODY_BYTES) {
				reject(new HttpError(413, "request body too large"));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			if (chunks.length === 0) {
				resolvePromise({});
				return;
			}
			try {
				resolvePromise(JSON.parse(Buffer.concat(chunks).toString("utf8")));
			} catch {
				reject(new HttpError(400, "invalid JSON body"));
			}
		});
		req.on("error", reject);
	});
}
/** ── Workspace containment ─────────────────────────────────────────────── */
/** Resolve a raw path and verify it lives inside some registered workspace. */
async function resolveWithinWorkspace(ctx, rawPath) {
	if (typeof rawPath !== "string" || rawPath === "") throw new HttpError(400, "path is required");
	let target;
	try {
		target = await ctx.fs.resolve(rawPath);
	} catch {
		throw new HttpError(404, "path does not exist");
	}
	for (const workspace of ctx.workspaceRegistry.list()) {
		let root;
		try {
			root = await ctx.fs.resolve(workspace.path);
		} catch {
			continue;
		}
		if (ctx.fs.contains(root, target)) return target;
	}
	throw new HttpError(403, "path is outside every workspace");
}
/** ── Route handlers ────────────────────────────────────────────────────── */
async function listWorkspaces(ctx) {
	return ctx.workspaceRegistry.list().map((workspace) => ({
		id: workspace.id,
		title: workspace.title,
		path: workspace.path
	}));
}
async function listDirectory(ctx, rawPath) {
	const target = await resolveWithinWorkspace(ctx, rawPath);
	const info = await ctx.fs.stat(target);
	if (info === void 0) throw new HttpError(404, "directory does not exist");
	if (info.type !== "directory") throw new HttpError(400, "path is not a directory");
	const rows = (await ctx.fs.listDir(target)).filter((entry) => entry.type === "file" || entry.type === "directory").map((entry) => ({
		name: entry.name,
		type: entry.type,
		size: entry.size
	}));
	rows.sort((a, b) => {
		if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
		return a.name.localeCompare(b.name);
	});
	return rows;
}
async function readFile$1(ctx, rawPath) {
	const target = await resolveWithinWorkspace(ctx, rawPath);
	const info = await ctx.fs.stat(target);
	if (info === void 0) throw new HttpError(404, "file does not exist");
	if (info.type !== "file") throw new HttpError(400, "path is not a file");
	if (info.size !== void 0 && info.size > MAX_READ_BYTES) throw new HttpError(413, "file is too large to preview");
	return {
		content: await ctx.fs.readText(target),
		version: info.version,
		path: target.displayPath
	};
}
async function writeFile$1(ctx, body) {
	if (typeof body.path !== "string" || body.path === "") throw new HttpError(400, "path is required");
	if (typeof body.content !== "string") throw new HttpError(400, "content is required");
	const target = await resolveWithinWorkspace(ctx, body.path);
	const expected = typeof body.version === "string" && body.version !== "" ? {
		kind: "replaceIfVersion",
		version: body.version
	} : void 0;
	const policyService = ctx.get("sandboxPolicy");
	const sandboxPolicy = policyService !== void 0 ? policyService.resolve({ mode: "danger-full-access" }) : void 0;
	const outcome = await ctx.fs.writeText(target, body.content, expected, void 0, sandboxPolicy);
	return {
		version: outcome.version,
		operation: outcome.operation
	};
}
/** ── Dispatch ──────────────────────────────────────────────────────────── */
async function handle(ctx, req, res) {
	if (!loopbackAllowed(req)) {
		json(res, 403, { error: "loopback-only" });
		return;
	}
	const url = new URL$1(req.url ?? "/", "http://localhost");
	const rest = url.pathname.slice(18);
	const method = req.method ?? "GET";
	try {
		if (method === "GET" && (rest === "" || rest === "/workspaces")) {
			json(res, 200, await listWorkspaces(ctx));
			return;
		}
		if (method === "GET" && rest === "/list") {
			json(res, 200, await listDirectory(ctx, url.searchParams.get("path")));
			return;
		}
		if (method === "GET" && rest === "/read") {
			json(res, 200, await readFile$1(ctx, url.searchParams.get("path")));
			return;
		}
		if (method === "PUT" && rest === "/write") {
			json(res, 200, await writeFile$1(ctx, await readBody(req)));
			return;
		}
		json(res, 404, { error: `no route for ${method} ${rest}` });
	} catch (error) {
		if (error instanceof HttpError) {
			json(res, error.status, { error: error.message });
			return;
		}
		if (error instanceof Error && typeof error.code === "string") {
			json(res, fsErrorStatus(error), {
				error: error.message,
				code: error.code
			});
			return;
		}
		json(res, 500, { error: error instanceof Error ? error.message : String(error) });
	}
}
/** 挂载 /api/file-explorer 路由（webui 组合调用）。 */
function applyFileExplorer(ctx) {
	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: ROUTE_PREFIX,
		handler: (req, res) => {
			handle(ctx, req, res);
		}
	}), "webui: file-explorer routes");
}
//#endregion
//#region src/usage-host.ts
/**
* webui — 用量统计 + 技能管理服务端（自 dsh-usage-skill 融合）。
*
* host 半身复用 dsh-usage-skill 的 lib 产物（JS 无类型声明）：
* - /api/usage-stats/*（usage/providers/balance/subscriptions/account/credentials）
* - /api/skill-manager/*（技能包管理）
* 由 webui 的 apply 统一装载，usage-skill 插件本身退役。
*/
/** 装载 usage-stats + skill-manager 的全部 host 行为。 */
async function applyUsageHost(ctx, config) {
	try {
		const usage = await import("./lib-DsrZesjT.mjs");
		if (typeof usage.apply === "function") await usage.apply(ctx, config ?? {});
		else console.error("[webui] applyUsageHost: dsh-usage-skill has no apply export");
	} catch (error) {
		console.error("[webui] applyUsageHost failed:", error?.message ?? error);
	}
}
Schema.object({
	modelRouterPath: Schema.string().default(""),
	visionModels: Schema.array(Schema.string()).default([]),
	timeoutMs: Schema.number().default(15e4),
	maxTokens: Schema.number().default(2048),
	defaultPrompt: Schema.string().default("用简洁的中文描述这张图片的关键内容：画面主体、布局结构、可见文字、界面元素。不要编造细节，看不清就直说。"),
	textModelImageFallback: Schema.boolean().default(true),
	fallbackDescribePrompt: Schema.string().default("用简洁的中文描述这张图片的关键内容：画面主体、布局结构、可见文字、界面元素。不要编造细节，看不清就直说。"),
	fallbackCacheSize: Schema.number().default(256)
});
const DEFAULT_VISION = "sensenova/sensenova-6.8-flash-lite";
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
function splitKey(key) {
	if (typeof key !== "string") return null;
	const idx = key.indexOf("/");
	if (idx <= 0 || idx === key.length - 1) return null;
	return {
		provider: key.slice(0, idx),
		model: key.slice(idx + 1)
	};
}
function psEscape(value) {
	return String(value).replace(/'/g, "''");
}
function imageFileExt(dataUrlPrefix) {
	const m = /^data:image\/(png|jpe?g|webp|gif)/.exec(dataUrlPrefix);
	if (!m) return "png";
	const ext = m[1];
	return ext === "jpeg" ? "jpg" : ext === "jpe" ? "jpg" : ext;
}
function isBase64Like(value) {
	return /^[A-Za-z0-9+/=\r\n]+$/.test(value) && value.length > 100;
}
/**
* 把 image 参数归一成 { dataUrlPrefix, base64 }。
* 支持：本地文件路径（相对工作区或绝对）、file://、data URL、裸 base64。
*/
async function resolveImageData(ctx, image) {
	const raw = String(image || "").trim();
	if (!raw) throw new Error("image 参数为空：需要图片文件路径、data URL 或 base64");
	if (raw.startsWith("data:")) {
		const comma = raw.indexOf(",");
		if (comma <= 0) throw new Error("data URL 格式无效");
		const prefix = raw.slice(0, comma + 1);
		const base64 = raw.slice(comma + 1);
		if (!base64) throw new Error("data URL 内容为空");
		return {
			prefix,
			base64,
			ref: "data-url"
		};
	}
	if (raw.startsWith("file://")) return readImageFile(ctx, raw.slice(7));
	if (path.isAbsolute(raw) && fs.existsSync(raw) && fs.statSync(raw).isFile()) return readImageFile(ctx, raw);
	try {
		const resolved = await ctx.fs.resolve(raw);
		if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return readImageFile(ctx, resolved);
	} catch {}
	if (isBase64Like(raw)) return {
		prefix: "data:image/png;base64,",
		base64: raw.replace(/\s+/g, ""),
		ref: "base64"
	};
	throw new Error(`无法识别 image 参数：既不是存在的文件（${raw.slice(0, 80)}…），也不是 data URL / base64`);
}
async function readImageFile(ctx, filePath) {
	const resolved = path.isAbsolute(filePath) ? filePath : await ctx.fs.resolve(filePath);
	if (!fs.existsSync(resolved)) throw new Error(`图片文件不存在：${resolved}`);
	const stat = fs.statSync(resolved);
	if (!stat.isFile()) throw new Error(`不是文件：${resolved}`);
	if (stat.size > MAX_IMAGE_BYTES) throw new Error(`图片过大（${stat.size} 字节，上限 ${MAX_IMAGE_BYTES}）`);
	const buf = fs.readFileSync(resolved);
	const ext = path.extname(resolved).toLowerCase().replace(".", "") || "png";
	const mime = ext === "jpg" ? "jpeg" : ext;
	const base64 = buf.toString("base64");
	return {
		prefix: `data:image/${mime};base64,`,
		base64,
		ref: resolved
	};
}
/** 解析 provider 配置（baseURL / apiKeyEnv），沿用 dsh-image-gen 的读取路径 */
function providerConfig(ctx, providerId) {
	try {
		const entry = ctx.llm.listConfigurableProviders().find((e) => e.provider === providerId);
		if (!entry || !entry.settingsNs) return null;
		const section = ctx.settings.get(entry.settingsNs);
		if (!section || typeof section !== "object") return null;
		let node = section;
		const pathKeys = Array.isArray(entry.settingsPath) ? entry.settingsPath : [];
		for (const key of pathKeys) if (node && typeof node === "object" && key in node) node = node[key];
		else return null;
		return node && typeof node === "object" ? node : null;
	} catch {
		return null;
	}
}
async function resolveApiKey(ctx, profile) {
	if (!profile || typeof profile.apiKeyEnv !== "string" || !profile.apiKeyEnv) return null;
	const credentials = ctx.get("credentials");
	if (!credentials) return null;
	try {
		const resolved = await credentials.resolve(profile.apiKeyEnv);
		return resolved ? String(resolved.value) : null;
	} catch {
		return null;
	}
}
/** 模型列表：Config.visionModels > model-router.json > 默认 */
async function resolveVisionModels(ctx, config) {
	if (config.visionModels.length > 0) return [...config.visionModels];
	try {
		const routerPath = config.modelRouterPath || ".dsh/model-router.json";
		const target = await ctx.fs.resolve(routerPath);
		const text = await ctx.fs.readText(target);
		const parsed = JSON.parse(text);
		const list = [];
		const active = typeof parsed.visionActive === "string" ? parsed.visionActive : "";
		if (active && splitKey(active)) list.push(active);
		if (Array.isArray(parsed.vision)) {
			for (const item of parsed.vision) if (item && typeof item.provider === "string" && typeof item.model === "string") {
				const key = `${item.provider}/${item.model}`;
				if (!list.includes(key)) list.push(key);
			}
		}
		if (list.length > 0) return list;
	} catch {}
	return [DEFAULT_VISION];
}
/**
* 调 chat/completions（PowerShell Invoke-RestMethod，danger-full-access 沙箱）。
* 图片 base64 在 PS 侧从临时文件读，命令行只传路径，避免 32K 长度上限。
*/
async function callVisionChat(ctx, baseURL, apiKey, model, imageBase64, prefix, prompt, maxTokens, timeoutMs, signal) {
	const tmpFile = path.join(os.tmpdir(), `dsh-vision-${process.pid}-${crypto$1.randomBytes(6).toString("hex")}.${imageFileExt(prefix)}`);
	fs.writeFileSync(tmpFile, Buffer.from(imageBase64, "base64"));
	const base = String(baseURL).replace(/[\\/]+$/, "");
	const escaped = {
		model: psEscape(model),
		prompt: psEscape(prompt),
		key: psEscape(apiKey),
		file: psEscape(tmpFile),
		url: psEscape(`${base}/chat/completions`)
	};
	const command = [
		"$ErrorActionPreference = 'Stop'",
		"[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12",
		`$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes('${escaped.file}'))`,
		`$body = @{ model = '${escaped.model}'; messages = @(@{ role = 'user'; content = @(@{ type = 'text'; text = '${escaped.prompt}' }, @{ type = 'image_url'; image_url = @{ url = "data:image/png;base64,$b64" } }) }); max_tokens = ${maxTokens} } | ConvertTo-Json -Depth 8 -Compress`,
		"try {",
		`  $r = Invoke-RestMethod -UseBasicParsing -Uri '${escaped.url}' -Method Post -Headers @{ Authorization = 'Bearer ${escaped.key}'; 'Content-Type' = 'application/json' } -Body $body -TimeoutSec ${Math.floor(timeoutMs / 1e3)}`,
		"  $m = $r.choices[0].message",
		"  @{ ok = $true; content = $m.content; finish = $r.choices[0].finish_reason; model = $r.model } | ConvertTo-Json -Depth 4 -Compress",
		"} catch {",
		"  $detail = ''",
		"  if ($_.ErrorDetails.Message) { $detail = $_.ErrorDetails.Message }",
		"  @{ ok = $false; error = $_.Exception.Message; detail = $detail } | ConvertTo-Json -Depth 4 -Compress",
		"}"
	].join("; ");
	try {
		const policy = ctx.sandboxPolicy.resolve({ mode: "danger-full-access" });
		const spec = ctx.shell.resolve({
			command,
			timeoutMs,
			signal,
			sandboxPolicy: policy
		});
		const result = await ctx.shell.run(spec);
		const stdout = result.stdout && result.stdout.text ? result.stdout.text : "";
		const stderr = result.stderr && result.stderr.text ? result.stderr.text : "";
		if (result.exitCode !== 0) return {
			ok: false,
			error: `shell 退出码 ${result.exitCode}`,
			detail: (stderr || stdout || "").slice(0, 500)
		};
		let parsed = null;
		try {
			parsed = JSON.parse(stdout);
		} catch {
			return {
				ok: false,
				error: "响应解析失败",
				detail: stdout.slice(0, 400)
			};
		}
		return parsed || {
			ok: false,
			error: "空响应"
		};
	} catch (error) {
		return {
			ok: false,
			error: String(error?.message ?? error)
		};
	} finally {
		try {
			fs.rmSync(tmpFile, { force: true });
		} catch {}
	}
}
function applyVisionHelper(ctx, config) {
	let imageActive = "";
	async function loadImageConfig() {
		try {
			const target = await ctx.fs.resolve(config.modelRouterPath || ".dsh/model-router.json");
			const parsed = JSON.parse(await ctx.fs.readText(target));
			if (parsed && typeof parsed.imageActive === "string") imageActive = parsed.imageActive;
			if (!imageActive && Array.isArray(parsed?.image) && parsed.image.length > 0) imageActive = parsed.image[0].provider + "/" + parsed.image[0].model;
		} catch {}
	}
	async function saveImageActive(key) {
		const target = await ctx.fs.resolve(config.modelRouterPath || ".dsh/model-router.json");
		let parsed = {};
		try {
			parsed = JSON.parse(await ctx.fs.readText(target));
		} catch {}
		const list = Array.isArray(parsed.image) ? parsed.image : [];
		const parts = splitKey(key);
		if (parts && !list.some((item) => item.provider === parts.provider && item.model === parts.model)) list.push({
			provider: parts.provider,
			model: parts.model
		});
		const next = {
			...parsed,
			image: list,
			imageActive: key
		};
		await ctx.fs.writeText(target, JSON.stringify(next, null, 2));
		imageActive = key;
	}
	/**
	* 单张生成（n=1，兼容性最好：部分 provider 不接受 n>1）。
	* @returns 成功返回 { ok: true, url }；失败返回 { ok: false, error }。
	*/
	async function generateOne(base, apiKey, model, prompt, signal) {
		const safePrompt = String(prompt).replace(/'/g, "''");
		const command = "$ErrorActionPreference = 'Stop'; [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12; try { $b = @{ model = '" + model + "'; prompt = '" + safePrompt + "'; n = 1 } | ConvertTo-Json -Compress; $r = Invoke-RestMethod -UseBasicParsing -Uri '" + base + "/images/generations' -Method Post -Headers @{ Authorization = 'Bearer " + apiKey + "'; 'Content-Type' = 'application/json' } -Body $b -TimeoutSec 300; @{ ok = $true; data = @($r.data) } | ConvertTo-Json -Depth 6 -Compress } catch { $inner = ''; if ($_.Exception.InnerException) { $inner = $_.Exception.InnerException.Message }; @{ ok = $false; error = $_.Exception.Message; inner = $inner; ps = $PSVersionTable.PSVersion.ToString() } | ConvertTo-Json -Compress }";
		try {
			const policy = ctx.sandboxPolicy.resolve({ mode: "danger-full-access" });
			const spec = ctx.shell.resolve({
				command,
				timeoutMs: 32e4,
				signal,
				sandboxPolicy: policy
			});
			const result = await ctx.shell.run(spec);
			const stdout = result.stdout && result.stdout.text ? result.stdout.text : "";
			const stderr = result.stderr && result.stderr.text ? result.stderr.text : "";
			if (result.exitCode !== 0) return {
				ok: false,
				error: `生图 API 调用失败 (exit ${result.exitCode}): ${(stderr || stdout || "未知错误").slice(0, 500)}`
			};
			let parsed = null;
			try {
				parsed = JSON.parse(stdout);
			} catch {
				return {
					ok: false,
					error: "生图 API 响应解析失败: " + stdout.slice(0, 400)
				};
			}
			if (!parsed || parsed.ok !== true) return {
				ok: false,
				error: "生图 API 错误: " + JSON.stringify(parsed).slice(0, 500)
			};
			const items = Array.isArray(parsed.data) ? parsed.data : [];
			for (const item of items) if (item && typeof item === "object") {
				const record = item;
				const url = typeof record.url === "string" && record.url ? record.url : typeof record.b64_json === "string" && record.b64_json ? "data:image/png;base64," + record.b64_json : null;
				if (url !== null) return {
					ok: true,
					url
				};
			}
			return {
				ok: false,
				error: "生图 API 返回空结果"
			};
		} catch (error) {
			return {
				ok: false,
				error: "生图 API 调用异常: " + String(error?.message ?? error)
			};
		}
	}
	/**
	* 一次生成 count 张（1-4）：逐张 n=1 调用后聚合，兼容不支持 n>1 的 provider。
	*/
	async function generateViaHttp(active, prompt, signal, count = 1) {
		const profile = providerConfig(ctx, active.provider);
		if (!profile || typeof profile.baseURL !== "string" || !profile.baseURL) return {
			ok: false,
			error: `provider "${active.provider}" 未配置 baseURL`
		};
		const apiKey = await resolveApiKey(ctx, profile);
		if (!apiKey) return {
			ok: false,
			error: `未找到生图 API 凭据（${profile.apiKeyEnv || "未知 env"}）：请在凭据设置中配置。`
		};
		const base = String(profile.baseURL).replace(/[\\/]+$/, "");
		const safeCount = Math.min(Math.max(Number.isFinite(count) ? Math.floor(count) : 1, 1), 4);
		const imageUrls = [];
		const failures = [];
		for (let index = 0; index < safeCount; index++) {
			const one = await generateOne(base, apiKey, active.model, prompt, signal);
			if (one.ok) {
				if (!imageUrls.includes(one.url)) imageUrls.push(one.url);
			} else failures.push(one.error);
		}
		if (imageUrls.length === 0) return {
			ok: false,
			error: failures[0] ?? "生图 API 返回空结果"
		};
		return {
			ok: true,
			model: `${active.provider}/${active.model}`,
			count: imageUrls.length,
			imageUrls,
			imageUrl: imageUrls[0] ?? null,
			imageDataUrl: null,
			...failures.length > 0 ? { partial: `其中 ${failures.length} 张失败：${failures[0]}` } : {}
		};
	}
	async function describe(imageArg, promptArg, signal) {
		const { prefix, base64, ref } = await resolveImageData(ctx, imageArg);
		const prompt = String(promptArg || "").trim() || config.defaultPrompt;
		const models = await resolveVisionModels(ctx, config);
		const failures = [];
		for (const key of models) {
			const active = splitKey(key);
			if (!active) continue;
			const profile = providerConfig(ctx, active.provider);
			if (!profile || typeof profile.baseURL !== "string" || !profile.baseURL) {
				failures.push(`${key}: provider "${active.provider}" 未配置 baseURL`);
				continue;
			}
			const apiKey = await resolveApiKey(ctx, profile);
			if (!apiKey) {
				failures.push(`${key}: 未找到 API 凭据（${profile.apiKeyEnv || "未知 env"}），请先在凭据设置中配置`);
				continue;
			}
			let res = await callVisionChat(ctx, profile.baseURL, apiKey, active.model, base64, prefix, prompt, config.maxTokens, config.timeoutMs, signal);
			if (res.ok && !res.content && res.finish === "length") {
				const bigger = Math.min(config.maxTokens * 4, 16384);
				if (bigger > config.maxTokens) res = await callVisionChat(ctx, profile.baseURL, apiKey, active.model, base64, prefix, prompt, bigger, config.timeoutMs, signal);
			}
			if (res.ok && typeof res.content === "string" && res.content.trim().length > 0) return {
				ok: true,
				text: res.content.trim(),
				model: `${active.provider}/${active.model}`,
				image: ref.length > 120 ? `…${ref.slice(-117)}` : ref
			};
			if (res.ok && !res.content) failures.push(`${key}: 模型未返回正文（finish=${res.finish || "unknown"}，可能 max_tokens 不足）`);
			else failures.push(`${key}: ${res.error || "未知错误"}${res.detail ? " — " + String(res.detail).slice(0, 300) : ""}`);
		}
		throw new Error(`所有视觉模型都失败了。尝试顺序：[${models.join(", ")}]\n` + failures.map((f) => `- ${f}`).join("\n"));
	}
	ctx.provide("vision-describe", describe);
	ctx.effect(() => ctx.tools.register(defineTool({
		name: "vision_describe",
		description: "辅助视觉：用视觉模型描述一张图片，返回文本。需要看图（页面截图、验证码、图表、图片内容）时使用，主模型无需图片能力。",
		parameters: {
			image: {
				type: "string",
				required: true,
				description: "图片：本地文件路径（相对工作区或绝对）、data URL 或 base64"
			},
			prompt: {
				type: "string",
				description: "可选：描述要求，缺省为通用中文描述"
			}
		},
		output: {
			schema: { type: "json" },
			render: (_args, value) => [{
				type: "text",
				text: JSON.stringify(value, null, 2)
			}]
		},
		async execute(args, exec) {
			return describe(String(args.image), args.prompt, exec?.signal);
		}
	})), "@dsh-external/dsh-vision-helper: vision_describe");
	ctx.effect(() => ctx.tools.register(defineTool({
		name: "generate_image",
		description: "调用已配置的生图模型生成一张或多张图片。当用户要求生成、绘制、创建图片或图像时使用本工具，提示词越详细越好；用户要求\"几张/多张\"时用 count 指定张数（最多 4 张），一次调用返回全部图片。若返回 ok=false，请把 error 信息转告用户（生图模型在「设置 → AI 模型」中配置）。",
		parameters: {
			prompt: {
				type: "string",
				required: true,
				description: "详细的图片生成提示词，建议包含主体、风格、场景、构图、光线等细节。"
			},
			count: {
				type: "number",
				description: "生成张数（1-4，默认 1）；多张会一次性返回，适合\"生成几张\"类需求"
			}
		},
		output: {
			schema: { type: "json" },
			render: (_args, value) => [{
				type: "text",
				text: JSON.stringify(value, null, 2)
			}]
		},
		async execute(args, exec) {
			const active = splitKey(imageActive);
			if (!active) return {
				ok: false,
				error: "尚未配置生图模型：请在「设置 → AI 模型」中选择生图模型。"
			};
			return generateViaHttp(active, String(args.prompt), exec?.signal, args.count);
		}
	})), "@dsh-external/dsh-vision-helper: generate_image");
	const VISION_CONVERTED = Symbol("@dsh-external/dsh-vision-helper/converted");
	function blocksHaveImage(blocks) {
		return blocks.some((block) => block.type === "image" || block.type === "tool-result" && blocksHaveImage(block.content));
	}
	function messagesHaveImage(messages) {
		return messages.some((message) => blocksHaveImage(message.content));
	}
	const modalityCache = /* @__PURE__ */ new Map();
	async function modelSupportsImage(provider, model) {
		const key = `${provider}/${model}`;
		const hit = modalityCache.get(key);
		if (hit !== void 0 && Date.now() - hit.at < 6e4) return hit.supportsImage;
		try {
			const entry = (await ctx.llm.listModels(provider)).find((item) => item.id === model);
			const modalities = Array.isArray(entry?.inputModalities) ? entry.inputModalities : void 0;
			if (modalities === void 0) return void 0;
			const supports = modalities.includes("image");
			modalityCache.set(key, {
				at: Date.now(),
				supportsImage: supports
			});
			return supports;
		} catch {
			return;
		}
	}
	if (config.textModelImageFallback) {
		const llmService = ctx.llm;
		const originalResolveModelInfo = llmService.resolveModelInfo.bind(llmService);
		llmService.resolveModelInfo = async (provider, model, signal) => {
			const info = await originalResolveModelInfo(provider, model, signal);
			if (info && Array.isArray(info.inputModalities) && !info.inputModalities.includes("image")) return {
				...info,
				inputModalities: void 0
			};
			return info;
		};
	}
	const descCache = /* @__PURE__ */ new Map();
	async function describeAttachment(attachment, signal) {
		const cached = descCache.get(attachment.attachmentId);
		if (cached !== void 0) return cached;
		try {
			const attachments = ctx.get("attachments");
			if (!attachments || typeof attachments.readImage !== "function") throw new Error("附件服务不可用");
			const stored = await attachments.readImage(attachment, signal);
			const res = await describe(`data:${stored.ref.mediaType};base64,${Buffer.from(stored.data).toString("base64")}`, config.fallbackDescribePrompt, signal);
			if (!res.ok) throw new Error(res.error || "未知错误");
			const text = `[图片·辅助视觉描述: ${res.text}]`;
			if (descCache.size >= config.fallbackCacheSize) descCache.clear();
			descCache.set(attachment.attachmentId, text);
			return text;
		} catch (error) {
			return `[图片（辅助视觉描述失败）: ${String(error?.message ?? error).slice(0, 300)}；请在「设置 → AI 模型」中确认辅助视觉模型已配置]`;
		}
	}
	async function convertBlocks(blocks, signal) {
		return Promise.all(blocks.map(async (block) => {
			if (block.type === "image") return {
				type: "text",
				text: await describeAttachment(block.attachment, signal)
			};
			if (block.type === "tool-result") return {
				...block,
				content: await convertBlocks(block.content, signal)
			};
			return block;
		}));
	}
	/**
	* 需要降级时返回转换后的请求；否则返回 null（含：开关关、无图、模型
	* 支持 image、能力未知、转换过程异常——一律原样放行，保持原错误行为）。
	*/
	async function convertRequest(options) {
		if (!config.textModelImageFallback) return null;
		if (!messagesHaveImage(options.messages)) return null;
		if (await modelSupportsImage(options.provider, options.model) !== false) return null;
		const messages = await Promise.all(options.messages.map(async (message) => ({
			...message,
			content: await convertBlocks(message.content, options.signal)
		})));
		return {
			...options,
			messages
		};
	}
	ctx.on("llm/stream", async function* (options, next) {
		if (options?.[VISION_CONVERTED]) {
			yield* next();
			return;
		}
		let converted = null;
		try {
			converted = await convertRequest(options);
		} catch {
			converted = null;
		}
		if (converted === null) {
			yield* next();
			return;
		}
		converted[VISION_CONVERTED] = true;
		yield* ctx.llm.stream(converted);
	}, { global: true });
	ctx.effect(() => {
		const webServer = ctx.webServer;
		if (!webServer) return;
		return webServer.register({
			kind: "exact",
			path: "/api/vision-helper/snapshot",
			handler: async (req, res) => {
				try {
					const models = await resolveVisionModels(ctx, config);
					const body = JSON.stringify({
						ok: true,
						models,
						active: models[0] || null
					});
					res.writeHead(200, {
						"content-type": "application/json",
						"cache-control": "no-store"
					});
					res.end(body);
				} catch (error) {
					res.writeHead(500, { "content-type": "application/json" });
					res.end(JSON.stringify({
						ok: false,
						error: String(error?.message ?? error)
					}));
				}
			}
		});
	});
	function jsonResponse(res, status, payload) {
		res.writeHead(status, {
			"content-type": "application/json",
			"cache-control": "no-store"
		});
		res.end(JSON.stringify(payload));
	}
	function readBody(req) {
		return new Promise((resolve) => {
			let data = "";
			req.on("data", (chunk) => {
				data += chunk;
			});
			req.on("end", () => {
				try {
					resolve(JSON.parse(data || "{}"));
				} catch {
					resolve(null);
				}
			});
			req.on("error", () => resolve(null));
		});
	}
	async function saveVisionActive(key) {
		const target = await ctx.fs.resolve(config.modelRouterPath || ".dsh/model-router.json");
		let parsed = {};
		try {
			parsed = JSON.parse(await ctx.fs.readText(target));
		} catch {}
		const list = Array.isArray(parsed.vision) ? parsed.vision : [];
		const parts = splitKey(key);
		if (parts && !list.some((item) => item.provider === parts.provider && item.model === parts.model)) list.push({
			provider: parts.provider,
			model: parts.model
		});
		const next = {
			...parsed,
			vision: list,
			visionActive: key
		};
		await ctx.fs.writeText(target, JSON.stringify(next, null, 2));
	}
	ctx.effect(() => {
		const webServer = ctx.webServer;
		if (!webServer) return;
		return webServer.register({
			kind: "exact",
			path: "/api/vision-helper/providers",
			handler: async (_req, res) => {
				try {
					const providers = [];
					for (const info of ctx.llm.listProviders()) {
						let models = [];
						try {
							models = await ctx.llm.listModels(info.id);
						} catch {}
						providers.push({
							id: info.id,
							name: info.name,
							models: models.map((m) => ({
								id: m.id,
								name: m.name || m.id,
								input: Array.isArray(m.input) ? m.input : null
							}))
						});
					}
					jsonResponse(res, 200, {
						ok: true,
						providers,
						active: (await resolveVisionModels(ctx, config))[0] || null
					});
				} catch (error) {
					jsonResponse(res, 500, {
						ok: false,
						error: String(error?.message ?? error)
					});
				}
			}
		});
	});
	ctx.effect(() => {
		const webServer = ctx.webServer;
		if (!webServer) return;
		return webServer.register({
			kind: "exact",
			path: "/api/vision-helper/config",
			handler: async (req, res) => {
				try {
					if (req.method !== "POST") return jsonResponse(res, 405, {
						ok: false,
						error: "method not allowed"
					});
					const body = await readBody(req);
					const key = body && typeof body.visionActive === "string" ? body.visionActive : "";
					if (!splitKey(key)) return jsonResponse(res, 400, {
						ok: false,
						error: "visionActive 须为 provider/model 格式"
					});
					await saveVisionActive(key);
					jsonResponse(res, 200, {
						ok: true,
						active: key
					});
				} catch (error) {
					jsonResponse(res, 500, {
						ok: false,
						error: String(error?.message ?? error)
					});
				}
			}
		});
	});
	ctx.effect(() => {
		const webServer = ctx.webServer;
		if (!webServer) return;
		return webServer.register({
			kind: "exact",
			path: "/api/image-gen/snapshot",
			handler: async (_req, res) => {
				try {
					const providers = [];
					for (const info of ctx.llm.listProviders()) {
						let models = [];
						try {
							models = await ctx.llm.listModels(info.id);
						} catch {}
						providers.push({
							id: info.id,
							name: info.name,
							models: models.map((m) => ({
								id: m.id,
								name: m.name || m.id
							}))
						});
					}
					jsonResponse(res, 200, {
						ok: true,
						providers,
						imageActive
					});
				} catch (error) {
					jsonResponse(res, 500, {
						ok: false,
						error: String(error?.message ?? error)
					});
				}
			}
		});
	});
	ctx.effect(() => {
		const webServer = ctx.webServer;
		if (!webServer) return;
		return webServer.register({
			kind: "exact",
			path: "/api/image-gen/config",
			handler: async (req, res) => {
				try {
					if (req.method !== "POST") return jsonResponse(res, 405, {
						ok: false,
						error: "method not allowed"
					});
					const body = await readBody(req);
					const key = body && typeof body.imageActive === "string" ? body.imageActive : "";
					if (!splitKey(key)) return jsonResponse(res, 400, {
						ok: false,
						error: "imageActive 须为 provider/model 格式"
					});
					await saveImageActive(key);
					jsonResponse(res, 200, {
						ok: true,
						imageActive: key
					});
				} catch (error) {
					jsonResponse(res, 500, {
						ok: false,
						error: String(error?.message ?? error)
					});
				}
			}
		});
	});
	loadImageConfig();
}
//#endregion
//#region ../../deepseek-harness/packages/web/web/lib/index.js
/**
* Vocabulary for the web capability seam (`ctx.web`). Search and fetch deliberately share one
* seam so provider selection, cancellation, errors, and product configuration have one owner,
* while retaining separate request and result types.
* @module @deepseek-ai/dsh-web/types
*/
/**
* Typed web error with a machine-routable, open-string `code` and chained `cause`.
* Consumers must tolerate provider-specific codes. Shared codes cover unavailable,
* missing, unusable, ambiguous, or duplicate providers, cancellation, and provider failure;
* the local fetch provider additionally distinguishes invalid or blocked URLs, redirects,
* size and timeout limits, and unsupported content types. Tool execution exposes the code in
* structured error metadata.
*/
var WebError = class extends HarnessError {};
(class extends Service {
	/**
	* Provider selection config. Operational env overrides feed the SAME fields:
	* `$DSH_WEB_SEARCH_PROVIDER` / `$DSH_WEB_FETCH_PROVIDER` are equivalent to
	* `searchProvider` / `fetchProvider` and are NOT a hidden priority chain.
	*/
	static Config = Schema.object({
		searchProvider: Schema.string(),
		fetchProvider: Schema.string()
	});
	searchProviders = /* @__PURE__ */ new Map();
	fetchProviders = /* @__PURE__ */ new Map();
	searchProviderId;
	fetchProviderId;
	constructor(ctx, config = {}) {
		super(ctx, "web");
		this.searchProviderId = config.searchProvider ?? process.env.DSH_WEB_SEARCH_PROVIDER;
		this.fetchProviderId = config.fetchProvider ?? process.env.DSH_WEB_FETCH_PROVIDER;
	}
	/**
	* Register a search provider. Throws {@link WebError} `WEB_DUPLICATE_PROVIDER`
	* if its id is already registered for search. Returns a disposer; disposed
	* with the calling fiber.
	* @param provider - the provider; its `id` is the registry key.
	* @returns the disposer that unregisters the provider.
	*/
	registerSearchProvider(provider) {
		return this.registerProvider(this.searchProviders, provider);
	}
	/**
	* Register a fetch provider. Throws {@link WebError} `WEB_DUPLICATE_PROVIDER`
	* if its id is already registered for fetch. Returns a disposer; disposed
	* with the calling fiber.
	* @param provider - the provider; its `id` is the registry key.
	* @returns the disposer that unregisters the provider.
	*/
	registerFetchProvider(provider) {
		return this.registerProvider(this.fetchProviders, provider);
	}
	registerProvider(store, provider) {
		if (store.has(provider.id)) throw new WebError(`a web provider with id "${provider.id}" is already registered`, "WEB_DUPLICATE_PROVIDER");
		const dispose = this.ctx.effect(function* () {
			store.set(provider.id, provider);
			yield () => store.delete(provider.id);
		}, "web.registerProvider()");
		return () => void dispose();
	}
	/**
	* Run one search through the selected provider. Resolves the provider at call
	* time with the selection rules above; throws {@link WebError} when the
	* capability cannot run. The seam enforces `request.maxResults` on the result:
	* if the provider over-returns, `sources[]` is truncated and `truncated` set.
	* @param request - the query and optional result limit.
	* @param signal - optional cancellation signal forwarded to the provider.
	* @returns the provider's results, capped to `request.maxResults`.
	*/
	async search(request, signal) {
		return capSources(await resolveProvider({
			providers: this.searchProviders,
			...this.searchProviderId !== void 0 ? { configuredId: this.searchProviderId } : {}
		}).search(request, signal), request.maxResults);
	}
	/**
	* Retrieve one URL through the selected provider. Resolves the provider at
	* call time with the selection rules above; throws {@link WebError} when the
	* capability cannot run. A non-2xx response is a result, not a throw.
	* @param request - the URL plus retrieval options.
	* @param signal - optional cancellation signal forwarded to the provider.
	* @returns the retrieval outcome; non-2xx responses resolve descriptively.
	*/
	async fetch(request, signal) {
		return resolveProvider({
			providers: this.fetchProviders,
			...this.fetchProviderId !== void 0 ? { configuredId: this.fetchProviderId } : {}
		}).fetch(request, signal);
	}
});
/** Resolve the selected provider or throw the matching {@link WebError}. */
function resolveProvider(selection) {
	const { configuredId, providers } = selection;
	if (configuredId !== void 0) {
		const provider = providers.get(configuredId);
		if (!provider) throw new WebError(`configured web provider "${configuredId}" is not registered`, "WEB_PROVIDER_CONFIGURED_MISSING");
		if (!provider.available()) throw new WebError(`configured web provider "${configuredId}" is registered but unavailable`, "WEB_PROVIDER_CONFIGURED_UNAVAILABLE");
		return provider;
	}
	const usable = [...providers.values()].filter((provider) => provider.available());
	const [single] = usable;
	if (single === void 0) throw new WebError("no usable web provider is registered", "WEB_PROVIDER_UNAVAILABLE");
	if (usable.length > 1) throw new WebError(`multiple usable web providers are registered (${usable.map((provider) => provider.id).join(", ")}); configure one explicitly`, "WEB_PROVIDER_AMBIGUOUS");
	return single;
}
/** Enforce `maxResults` on a search result: truncate `sources[]` and flag it. */
function capSources(result, maxResults) {
	if (maxResults === void 0 || result.sources.length <= maxResults) return result;
	return {
		...result,
		sources: result.sources.slice(0, maxResults),
		truncated: true
	};
}
//#endregion
//#region src/provider.ts
/**
* `AnySearchSearchProvider`: a `WebSearchProvider` backed by the AnySearch
* unified search API (`POST /v1/search`). It maps each result's
* `title`/`url`/`snippet` into the normalized source shape and omits `content`
* because AnySearch returns per-result body content, not a generated answer.
* @module dsh-web-search-anysearch/provider
*/
/** Stable id this provider registers under. */
const ANYSEARCH_PROVIDER_ID = "anysearch";
/** Attribution header sent on every request. */
const USER_AGENT = "dsh-web-search-anysearch/0.1.0";
/**
* Map an AnySearch response envelope to a normalized search result. Entries
* without a URL are dropped; `title` and `snippet` are optional on the wire and
* stay optional here. The web service owns the final `maxResults` truncation,
* so this provider reports `truncated: false`.
* @param response - the parsed `POST /v1/search` response body.
* @returns the normalized result.
*/
function mapAnySearchResponse(response) {
	if (response.code !== void 0 && response.code !== 0) {
		const message = response.message?.trim();
		throw new WebError(`AnySearch API ${message !== void 0 && message.length > 0 ? message : `code ${response.code}`}`, "WEB_PROVIDER_ERROR");
	}
	const sources = [];
	const results = response.data?.results ?? response.results ?? [];
	for (const result of results) {
		const url = result.url;
		if (url === void 0 || url.length === 0) continue;
		const snippet = result.snippet ?? result.description;
		sources.push({
			url,
			...result.title !== void 0 && result.title.length > 0 ? { title: result.title } : {},
			...snippet !== void 0 && snippet.length > 0 ? { snippet } : {},
			...result.published_at !== void 0 && result.published_at.length > 0 ? { publishedAt: result.published_at } : {}
		});
	}
	return {
		sources,
		truncated: false
	};
}
/** The AnySearch-backed search provider; HTTP redirects fail as `WEB_PROVIDER_ERROR`. */
var AnySearchSearchProvider = class {
	resolveOptions;
	id = ANYSEARCH_PROVIDER_ID;
	/**
	* @param resolveOptions - options for the NEXT operation, snapshotted once at
	* each operation's entry so one search never mixes two settings revisions.
	*/
	constructor(resolveOptions) {
		this.resolveOptions = resolveOptions;
	}
	available() {
		const options = this.resolveOptions();
		return URL.canParse(options.baseURL) && (options.maxResults === void 0 || isPositiveInteger(options.maxResults));
	}
	async search(request, signal) {
		const options = this.resolveOptions();
		const apiKey = await this.apiKey(options, signal);
		throwIfSearchAborted(signal);
		const maxResults = request.maxResults ?? options.maxResults;
		let response;
		try {
			response = await fetch(`${options.baseURL}/v1/search`, {
				method: "POST",
				redirect: "error",
				headers: {
					"content-type": "application/json",
					"accept": "application/json",
					"user-agent": USER_AGENT,
					...apiKey !== void 0 && apiKey.length > 0 ? { "authorization": `Bearer ${apiKey}` } : {}
				},
				body: JSON.stringify({
					query: request.query,
					...maxResults !== void 0 ? { max_results: maxResults } : {},
					...options.tag !== void 0 && options.tag.length > 0 ? { tag: options.tag } : {},
					...options.zone !== void 0 && options.zone.length > 0 ? { zone: options.zone } : {},
					...options.language !== void 0 && options.language.length > 0 ? { language: options.language } : {}
				}),
				...signal !== void 0 ? { signal } : {}
			});
		} catch (error) {
			if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error);
			throw new WebError(`AnySearch search request failed: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
		}
		if (!response.ok) {
			let message = `AnySearch API error (HTTP ${response.status})`;
			try {
				const detail = (await response.json()).message;
				if (detail !== void 0 && detail.length > 0) message = detail;
			} catch (error) {
				if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error);
			}
			throw new WebError(message, "WEB_PROVIDER_ERROR");
		}
		try {
			return mapAnySearchResponse(await response.json());
		} catch (error) {
			if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error);
			throw new WebError(`AnySearch returned an unprocessable response body: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
		}
	}
	/**
	* Resolve one operation's credential without retaining it on the provider.
	* @param options - the caller's snapshot, so the key and the endpoint it is sent to come from one section.
	* @param signal - abort signal for the surrounding search.
	* @returns the resolved key.
	*/
	async apiKey(options, signal) {
		throwIfSearchAborted(signal);
		if (options.apiKey !== void 0 && options.apiKey.length > 0) return options.apiKey;
		let resolved;
		try {
			resolved = await abortable(options.resolveApiKey?.() ?? Promise.resolve(void 0), signal);
		} catch (error) {
			if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error);
			throw new WebError(`AnySearch search credential resolution failed: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
		}
		return resolved !== void 0 && resolved.length > 0 ? resolved : void 0;
	}
};
/**
* Race a same-process asynchronous preflight against caller cancellation. The
* attached settlement handlers keep observing an uncooperative operation after
* abort so a later rejection cannot become unhandled.
*/
function abortable(operation, signal) {
	if (signal === void 0) return operation;
	if (signal.aborted) return Promise.reject(searchAborted(signal));
	return new Promise((resolve, reject) => {
		const onAbort = () => {
			reject(searchAborted(signal));
		};
		signal.addEventListener("abort", onAbort, { once: true });
		operation.then((value) => {
			signal.removeEventListener("abort", onAbort);
			resolve(value);
		}, (error) => {
			signal.removeEventListener("abort", onAbort);
			reject(new Error(String(error).replace(/^Error: /u, ""), { cause: error }));
		});
	});
}
/** Throw the provider's stable cancellation error when the caller already aborted. */
function throwIfSearchAborted(signal) {
	if (signal?.aborted === true) throw searchAborted(signal);
}
/** Build the provider's stable cancellation error while retaining the caller's reason. */
function searchAborted(signal, fallback) {
	return new WebError("AnySearch search aborted", "WEB_ABORTED", { cause: signal?.aborted === true ? signal.reason : fallback });
}
/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
function isAbortError(error) {
	return error instanceof DOMException && error.name === "AbortError";
}
/** True for a request limit that can be sent to AnySearch (a positive whole number). */
function isPositiveInteger(value) {
	return Number.isInteger(value) && value > 0;
}
//#endregion
//#region src/index.ts
const name = "dsh-webui";
const inject = [
	"settings",
	"tools",
	"web",
	"systemPrompt",
	"webServer",
	"sandboxPolicy",
	"fs",
	"workspaceRegistry",
	"credentials",
	"sessions",
	"sessionPersistence",
	"llm",
	"shell"
];
/** 供应商级推理等级模板：等级名 → 发送给该供应商的线值（string 或 null）。 */
const PROVIDER_REASONING_TEMPLATES = {
	sensenova: {
		off: "none",
		low: "low",
		medium: "medium",
		high: "high",
		xhigh: "xhigh"
	},
	agnes: {
		off: "none",
		low: "low",
		medium: "medium",
		high: "high",
		max: "max"
	},
	rhythm: {
		off: null,
		low: "low",
		medium: "medium",
		high: "high",
		xhigh: "xhigh",
		max: "max"
	},
	bai: {
		off: null,
		low: "low",
		medium: "medium",
		high: "high",
		xhigh: "xhigh",
		max: "max"
	},
	pl: {
		off: null,
		low: "low",
		high: "high",
		xhigh: "max"
	}
};
/** AnySearch API key 默认环境变量。 */
const DEFAULT_API_KEY_ENV = "ANYSEARCH_API_KEY";
const AnySearchConfigSchema = Schema.object({
	apiKey: Schema.string().role("secret"),
	apiKeyEnv: Schema.string().role("credential-ref").default(DEFAULT_API_KEY_ENV),
	baseURL: Schema.string(),
	maxResults: Schema.number().step(1).min(1),
	tag: Schema.string(),
	zone: Schema.string(),
	language: Schema.string()
});
/** 设置命名空间承载 provider 的 key 引用与选项。 */
const WEB_SEARCH_ANYSEARCH_SETTINGS_NAMESPACE = settingsNamespace("web-search-anysearch");
/**
* 把已解析的 section 投影为 provider 下一次搜索的选项；环境变量回退放在这
* 里而非 provider 内，provider 读到的每个值都已完全默认化。
*/
function resolveAnySearchOptions(ctx, config) {
	const apiKeyEnv = credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV);
	const literalApiKey = config.apiKey !== void 0 && config.apiKey.length > 0 ? config.apiKey : void 0;
	return {
		...literalApiKey === void 0 ? {} : { apiKey: literalApiKey },
		resolveApiKey: async () => {
			const credentials = ctx.get("credentials");
			if (credentials !== void 0) return (await credentials.resolve(apiKeyEnv))?.value;
			const ambient = launchEnvironmentOf(ctx).get(apiKeyEnv);
			return ambient !== void 0 && ambient.value.length > 0 ? ambient.value : void 0;
		},
		apiKeyEnv,
		baseURL: config.baseURL ?? "https://api.anysearch.com",
		...config.maxResults !== void 0 ? { maxResults: config.maxResults } : {},
		...config.tag !== void 0 && config.tag.length > 0 ? { tag: config.tag } : {},
		...config.zone !== void 0 && config.zone.length > 0 ? { zone: config.zone } : {},
		...config.language !== void 0 && config.language.length > 0 ? { language: config.language } : {}
	};
}
/**
* 注册 `webui_sync_reasoning` 工具 + AnySearch 搜索 provider + 中文思考开关
* + 任务完成提示音 + 辅助视觉/生图。
* @param ctx - host 上下文。
* @param config - 组合配置（默认空对象，各能力自带默认值）。
*/
async function apply(ctx, config = {}) {
	ctx.tools.register(defineTool({
		name: "webui_sync_reasoning",
		description: "为 settings 里 llm-pi-ai 各供应商中缺失 reasoningEfforts（推理等级）的模型，按内置供应商级模板自动补全，免去手工编辑 settings.yaml。已有配置或未收录供应商不受影响。",
		parameters: {},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					patched: {
						type: "array",
						required: true,
						items: { type: "string" }
					},
					skipped: {
						type: "array",
						required: true,
						items: { type: "string" }
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: `已补全 ${value.patched.length} 个模型的推理等级：${value.patched.join(", ") || "(无)"}。跳过 ${value.skipped.length} 个：${value.skipped.join(", ") || "(无)"}。`
			}]
		},
		async execute() {
			const ns = settingsNamespace("llm-pi-ai");
			const providers = ctx.settings.get(ns)?.providers;
			const patched = [];
			const skipped = [];
			if (providers === void 0) return {
				patched,
				skipped
			};
			let changed = false;
			const nextProviders = {};
			for (const [providerId, provider] of Object.entries(providers)) {
				const template = PROVIDER_REASONING_TEMPLATES[providerId];
				const models = Array.isArray(provider?.models) ? provider.models : [];
				if (template === void 0 || models.length === 0) {
					nextProviders[providerId] = provider;
					continue;
				}
				const nextModels = models.map((model) => {
					const id = typeof model.id === "string" ? model.id : "";
					if (model.reasoningEfforts !== void 0) return model;
					if (id === "") {
						skipped.push(`${providerId}/<无 id>`);
						return model;
					}
					patched.push(`${providerId}/${id}`);
					changed = true;
					return {
						...model,
						reasoningEfforts: { ...template }
					};
				});
				nextProviders[providerId] = {
					...provider,
					models: nextModels
				};
			}
			if (changed) await ctx.settings.update(ns, { providers: nextProviders });
			return {
				patched,
				skipped
			};
		},
		presentCall: () => ({
			card: "generic",
			title: "同步模型推理等级",
			kind: "other",
			rawInput: null
		})
	}));
	let current = () => config;
	installSettingsSection(ctx, WEB_SEARCH_ANYSEARCH_SETTINGS_NAMESPACE, AnySearchConfigSchema, config, {
		setSource: (source) => {
			current = source;
		},
		onChange: () => {}
	});
	ctx.web.registerSearchProvider(new AnySearchSearchProvider(() => resolveAnySearchOptions(ctx, current())));
	applyZhThinking(ctx);
	applyTaskDoneSound(ctx);
	applyUpdater(ctx, config.updater);
	applyProxy(ctx);
	applyBrowser(ctx, {
		chromePath: "",
		port: 0,
		headless: false,
		screenshotDir: "",
		...config.browser
	});
	applyMemory(ctx, config.memory);
	applyFileExplorer(ctx);
	await applyUsageHost(ctx, config.usage);
	applyVisionHelper(ctx, config.visionHelper ?? {});
}
//#endregion
export { apply, inject, name };

//# sourceMappingURL=index.js.map