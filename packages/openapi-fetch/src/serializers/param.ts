export type SerializePrimitiveOptions = {
  allowReserved?: boolean;
};

/** Serialize primitive params to string */
export function serializePrimitiveParam(
  name: string,
  value: string | number | boolean | null | undefined,
  options?: SerializePrimitiveOptions,
): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "object") {
    throw new Error(
      "Deeply-nested arrays/objects aren’t supported. Provide your own `querySerializer()` to handle these.",
    );
  }
  return `${name}=${options?.allowReserved === true ? value : encodeURIComponent(value)}`;
}

export type SerializeObjectOptions = {
  style: "simple" | "label" | "matrix" | "form" | "deepObject";
  explode: boolean;
  allowReserved?: boolean;
};

/** Serialize object param to string */
export function serializeObjectParam(
  name: string,
  value: Record<string, unknown>,
  options: SerializeObjectOptions,
): string {
  if (!value || typeof value !== "object") {
    return "";
  }
  const values: Array<string | unknown> = [];
  const joiner =
    {
      simple: ",",
      label: ".",
      matrix: ";",
    }[options.style as "simple" | "label" | "matrix"] || "&";

  // explode: false
  if (options.style !== "deepObject" && options.explode === false) {
    for (const k in value) {
      values.push(
        k,
        options.allowReserved === true ? value[k] : encodeURIComponent(String(value[k])),
      );
    }
    const final = values.join(","); // note: values are always joined by comma in explode: false (but joiner can prefix)
    switch (options.style) {
      case "form": {
        return `${name}=${final}`;
      }
      case "label": {
        return `.${final}`;
      }
      case "matrix": {
        return `;${name}=${final}`;
      }
      default: {
        return final;
      }
    }
  }

  // explode: true
  for (const k in value) {
    const finalName = options.style === "deepObject" ? `${name}[${k}]` : k;
    values.push(serializePrimitiveParam(finalName, value[k] as string | number | boolean, options));
  }
  const final = values.join(joiner);
  return options.style === "label" || options.style === "matrix" ? `${joiner}${final}` : final;
}

export type SerializeArrayOptions = {
  style: "simple" | "label" | "matrix" | "form" | "spaceDelimited" | "pipeDelimited";
  explode: boolean;
  allowReserved?: boolean;
};

/** Serialize array param (shallow only) */
export function serializeArrayParam(
  name: string,
  value: unknown[],
  options: SerializeArrayOptions,
): string {
  if (!Array.isArray(value)) {
    return "";
  }

  // explode: false
  if (options.explode === false) {
    // note: for arrays, joiners vary wildly based on style + explode behavior
    const joiner =
      { form: ",", spaceDelimited: "%20", pipeDelimited: "|" }[
        options.style as "form" | "spaceDelimited" | "pipeDelimited"
      ] || ",";
    const final = (
      options.allowReserved === true ? value : value.map((v) => encodeURIComponent(String(v)))
    ).join(joiner);
    switch (options.style) {
      case "simple": {
        return final;
      }
      case "label": {
        return `.${final}`;
      }
      case "matrix": {
        return `;${name}=${final}`;
      }
      // case "spaceDelimited":
      // case "pipeDelimited":
      default: {
        return `${name}=${final}`;
      }
    }
  }

  // explode: true
  const joiner =
    { simple: ",", label: ".", matrix: ";" }[options.style as "simple" | "label" | "matrix"] || "&";
  const values = [];
  for (const v of value) {
    if (options.style === "simple" || options.style === "label") {
      values.push(options.allowReserved === true ? v : encodeURIComponent(String(v)));
    } else {
      values.push(serializePrimitiveParam(name, v as string | number | boolean, options));
    }
  }
  return options.style === "label" || options.style === "matrix"
    ? `${joiner}${values.join(joiner)}`
    : values.join(joiner);
}
