# Advanced Examples: Combining the Rules

Now let's tackle more complex problems that require using multiple differentiation rules together.

## Example 1: Product Rule + Chain Rule

Find $\frac{d}{dx}[x^2(3x - 1)^5]$

**Solution:**
This is a product of $f(x) = x^2$ and $g(x) = (3x - 1)^5$

Product rule: $f'(x)g(x) + f(x)g'(x)$

- $f'(x) = 2x$
- $g'(x) = 5(3x - 1)^4 \cdot 3 = 15(3x - 1)^4$ (chain rule!)

Result:
$$\frac{d}{dx}[x^2(3x - 1)^5] = 2x(3x - 1)^5 + x^2 \cdot 15(3x - 1)^4$$
$$= 2x(3x - 1)^5 + 15x^2(3x - 1)^4$$

We can factor out $(3x - 1)^4$:
$$= (3x - 1)^4[2x(3x - 1) + 15x^2]$$
$$= (3x - 1)^4[6x^2 - 2x + 15x^2]$$
$$= (3x - 1)^4[21x^2 - 2x]$$

## Example 2: Nested Chain Rule

Find $\frac{d}{dx}[(x^3 + 2x)^4]$

**Solution:**
Outer function: $u^4$ → derivative is $4u^3$

Inner function: $u = x^3 + 2x$ → derivative is $3x^2 + 2$

Chain rule:
$$\frac{d}{dx}[(x^3 + 2x)^4] = 4(x^3 + 2x)^3(3x^2 + 2)$$

## Example 3: Triple Product

Find $\frac{d}{dx}[x \cdot (x^2 + 1) \cdot (2x - 3)]$

**Solution:**
For three factors, we extend the product rule. One approach: treat it as $[x(x^2 + 1)] \cdot (2x - 3)$

Let $u = x(x^2 + 1) = x^3 + x$ and $v = 2x - 3$

Then $u' = 3x^2 + 1$ and $v' = 2$

$$\frac{d}{dx}[uv] = u'v + uv' = (3x^2 + 1)(2x - 3) + (x^3 + x)(2)$$
$$= 6x^3 - 9x^2 + 2x - 3 + 2x^3 + 2x$$
$$= 8x^3 - 9x^2 + 4x - 3$$

## Example 4: Quotient-Like Problem

Find $\frac{d}{dx}[x^{-2}(x + 1)^3]$

**Solution:**
This is a product: $f(x) = x^{-2}$ and $g(x) = (x + 1)^3$

- $f'(x) = -2x^{-3}$
- $g'(x) = 3(x + 1)^2$ (chain rule)

Product rule:
$$\frac{d}{dx}[x^{-2}(x + 1)^3] = -2x^{-3}(x + 1)^3 + x^{-2} \cdot 3(x + 1)^2$$
$$= \frac{-2(x + 1)^3}{x^3} + \frac{3(x + 1)^2}{x^2}$$

Factor out common terms:
$$= \frac{(x + 1)^2}{x^3}[-2(x + 1) + 3x]$$
$$= \frac{(x + 1)^2}{x^3}[x - 2]$$

## Example 5: Maximum Complexity

Find $\frac{d}{dx}[(2x^2 + 3)^2(x^3 - 1)^3]$

**Solution:**
Product of $f(x) = (2x^2 + 3)^2$ and $g(x) = (x^3 - 1)^3$

For $f'(x)$: chain rule → $2(2x^2 + 3) \cdot 4x = 8x(2x^2 + 3)$

For $g'(x)$: chain rule → $3(x^3 - 1)^2 \cdot 3x^2 = 9x^2(x^3 - 1)^2$

Product rule:
$$= 8x(2x^2 + 3)(x^3 - 1)^3 + (2x^2 + 3)^2 \cdot 9x^2(x^3 - 1)^2$$

Factor out common terms $(2x^2 + 3)(x^3 - 1)^2$:
$$= x(2x^2 + 3)(x^3 - 1)^2[8(x^3 - 1) + 9x(2x^2 + 3)]$$
$$= x(2x^2 + 3)(x^3 - 1)^2[8x^3 - 8 + 18x^3 + 27x]$$
$$= x(2x^2 + 3)(x^3 - 1)^2[26x^3 + 27x - 8]$$
