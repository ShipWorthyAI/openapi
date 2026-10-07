import ts from "#compiler";

export default {
postTransform: postTransform(_type, options) {
            if (options.path?.includes("Date"))
              return ts.factory.createTypeReferenceNode(ts.factory.createIdentifier("DateOrTime"));
            const schema = options.schema;
            if (schema && !("$ref" in schema) && Object.hasOwn(schema, "x-string-enum-to-set") && schema.type === "string" && schema.enum?.every((enumMember) => {
              return typeof enumMember === "string";
            }))
              return ts.factory.createTypeReferenceNode(ts.factory.createIdentifier("Set"), [
                ts.factory.createUnionTypeNode(schema.enum.map((value) => {
                  return ts.factory.createLiteralTypeNode(ts.factory.createStringLiteral(value));
                }))
              ]);
          }
};
