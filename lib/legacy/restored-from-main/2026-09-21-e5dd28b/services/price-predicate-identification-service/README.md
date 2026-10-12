# @red-cup-engineering/price-predicate-identification-service

Prices the cheapest chain of mld or equal declarations identifying one predicate with another.

## Operation

~~~js
export function pricePredicateIdentification(request)
~~~

### Parameters

- request (object): A record with declarations ([{a, kind, b}]), from, and to.

### Returns

object: A PredicateIdentificationPrice record with path, price, and kind (null when unreachable).

### Refusals

- TypeError: When from, to, or declarations are malformed or a declaration kind is unknown.

## Command

price-predicate-identification reads one JSON value per input line and writes one JSON value per output line.

## Examples

### mixed chain

Input:

~~~json
{
  "declarations": [
    {
      "a": "part-of",
      "kind": "mld",
      "b": "component-of"
    },
    {
      "a": "component-of",
      "kind": "equal",
      "b": "constituent-of"
    }
  ],
  "from": "part-of",
  "to": "constituent-of"
}
~~~

Output:

~~~json
{
  "type": "PredicateIdentificationPrice",
  "from": "part-of",
  "to": "constituent-of",
  "path": [
    {
      "a": "part-of",
      "kind": "mld",
      "b": "component-of"
    },
    {
      "a": "component-of",
      "kind": "equal",
      "b": "constituent-of"
    }
  ],
  "price": 3,
  "kind": "mld"
}
~~~
