# The Chain Rule

The **chain rule** is perhaps the most important differentiation rule. It tells us how to find the derivative of a **composition** of functions—a function inside another function.

## The Rule

If $y = f(g(x))$, then:

$$\frac{dy}{dx} = f'(g(x)) \cdot g'(x)$$

Or in Leibniz notation, if $y = f(u)$ and $u = g(x)$:

$$\frac{dy}{dx} = \frac{dy}{du} \cdot \frac{du}{dx}$$

In words: **derivative of the outer function (evaluated at the inner function) times the derivative of the inner function**.

## Intuition

Think of it as a "chain" of rates of change:
- If $u$ changes at a certain rate with respect to $x$
- And $y$ changes at a certain rate with respect to $u$
- Then $y$ changes with respect to $x$ at the **product** of these rates

## Example 1: Power of a Function

Find $\frac{d}{dx}[(3x^2 + 5)^4]$

**Solution:**
Here the outer function is $f(u) = u^4$ and the inner function is $u = 3x^2 + 5$

- Derivative of outer: $f'(u) = 4u^3$
- Derivative of inner: $\frac{du}{dx} = 6x$

Chain rule:
$$\frac{d}{dx}[(3x^2 + 5)^4] = 4(3x^2 + 5)^3 \cdot 6x = 24x(3x^2 + 5)^3$$

## Example 2: Nested Functions

Find $\frac{d}{dx}[(x^2 + 1)^5]$

**Solution:**
Outer: $f(u) = u^5$, so $f'(u) = 5u^4$

Inner: $u = x^2 + 1$, so $\frac{du}{dx} = 2x$

Result:
$$\frac{d}{dx}[(x^2 + 1)^5] = 5(x^2 + 1)^4 \cdot 2x = 10x(x^2 + 1)^4$$

## Example 3: Multiple Chains

Find $\frac{d}{dx}[((2x + 3)^2)^3]$

**Solution:**
This is $[(2x + 3)^2]^3 = (2x + 3)^6$

We can apply the chain rule in layers:

Outermost: power of 6 → brings down 6
Middle: the expression $2x + 3$ stays
Innermost: derivative of $2x + 3$ is 2

$$\frac{d}{dx}[(2x + 3)^6] = 6(2x + 3)^5 \cdot 2 = 12(2x + 3)^5$$

## Common Pattern

For $\frac{d}{dx}[f(x)^n]$ where $f(x)$ is any function:

$$\frac{d}{dx}[f(x)^n] = n \cdot f(x)^{n-1} \cdot f'(x)$$

This pattern appears constantly in calculus!
