# The Product Rule

What happens when we need to find the derivative of two functions multiplied together? The **product rule** gives us the answer.

## The Rule

If $f(x)$ and $g(x)$ are both differentiable functions, then:

$$\frac{d}{dx}[f(x) \cdot g(x)] = f'(x) \cdot g(x) + f(x) \cdot g'(x)$$

In words: **derivative of the first times the second, plus the first times derivative of the second**.

A common mnemonic: "**first times derivative of second, plus second times derivative of first**"

## Why We Need It

You might think that $\frac{d}{dx}[f(x)g(x)] = f'(x)g'(x)$, but this is **incorrect**!

For example, let $f(x) = x$ and $g(x) = x$. Then $f(x)g(x) = x^2$.

- Wrong approach: $f'(x)g'(x) = 1 \cdot 1 = 1$
- Correct answer: $\frac{d}{dx}(x^2) = 2x$

The product rule gives us the right answer:
$$\frac{d}{dx}[x \cdot x] = 1 \cdot x + x \cdot 1 = 2x$$

✓

## Example 1: Simple Product

Find $\frac{d}{dx}[(3x^2)(5x^4)]$

**Solution:**
Let $f(x) = 3x^2$ and $g(x) = 5x^4$

Then $f'(x) = 6x$ and $g'(x) = 20x^3$

Applying the product rule:
$$\frac{d}{dx}[(3x^2)(5x^4)] = (6x)(5x^4) + (3x^2)(20x^3)$$
$$= 30x^5 + 60x^5 = 90x^5$$

We could verify this by first multiplying: $(3x^2)(5x^4) = 15x^6$, so the derivative is $90x^5$ ✓

## Example 2: Different Functions

Find $\frac{d}{dx}[(x^3 + 2)(x^2 - 5x)]$

**Solution:**
Let $f(x) = x^3 + 2$ and $g(x) = x^2 - 5x$

Then $f'(x) = 3x^2$ and $g'(x) = 2x - 5$

Product rule:
$$\frac{d}{dx}[(x^3 + 2)(x^2 - 5x)] = (3x^2)(x^2 - 5x) + (x^3 + 2)(2x - 5)$$
$$= 3x^4 - 15x^3 + 2x^4 - 5x^3 + 4x - 10$$
$$= 5x^4 - 20x^3 + 4x - 10$$
