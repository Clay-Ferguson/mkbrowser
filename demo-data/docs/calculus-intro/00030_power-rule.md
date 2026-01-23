# The Power Rule

The **power rule** is one of the most fundamental and useful rules for computing derivatives. It applies to any function of the form $f(x) = x^n$ where $n$ is a real number.

## The Rule

If $f(x) = x^n$, then:

$$f'(x) = nx^{n-1}$$

In words: **bring down the exponent as a coefficient, then reduce the exponent by 1**.

## Examples

Let's see the power rule in action:

1. $f(x) = x^3 \Rightarrow f'(x) = 3x^2$
2. $f(x) = x^5 \Rightarrow f'(x) = 5x^4$
3. $f(x) = x^{10} \Rightarrow f'(x) = 10x^9$

## Special Cases

The power rule works for all exponents:

**Negative exponents:**
$$\frac{d}{dx}\left(\frac{1}{x^2}\right) = \frac{d}{dx}(x^{-2}) = -2x^{-3} = -\frac{2}{x^3}$$

**Fractional exponents:**
$$\frac{d}{dx}(\sqrt{x}) = \frac{d}{dx}(x^{1/2}) = \frac{1}{2}x^{-1/2} = \frac{1}{2\sqrt{x}}$$

**Constants:**
$$\frac{d}{dx}(c) = \frac{d}{dx}(cx^0) = 0$$

A constant has zero rate of change, which makes intuitive sense!

## Quick Proof Sketch

We can verify the power rule using the limit definition. For $f(x) = x^2$:

$$f'(x) = \lim_{h \to 0} \frac{(x+h)^2 - x^2}{h} = \lim_{h \to 0} \frac{x^2 + 2xh + h^2 - x^2}{h}$$

$$= \lim_{h \to 0} \frac{2xh + h^2}{h} = \lim_{h \to 0} (2x + h) = 2x$$

This matches our power rule prediction: $\frac{d}{dx}(x^2) = 2x^1 = 2x$ ✓
