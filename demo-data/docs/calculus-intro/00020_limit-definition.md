# The Limit Definition of the Derivative

The formal mathematical definition of the derivative uses the concept of a **limit**. This definition captures the idea of instantaneous rate of change.

## The Definition

For a function $f(x)$, the derivative at a point $x$ is defined as:

$$f'(x) = \lim_{h \to 0} \frac{f(x + h) - f(x)}{h}$$

Let's break this down:
- $f(x + h)$ is the function value at a point slightly ahead of $x$
- $f(x)$ is the function value at $x$
- The fraction $\frac{f(x + h) - f(x)}{h}$ is the **average rate of change** over the interval from $x$ to $x + h$
- Taking the limit as $h \to 0$ gives us the **instantaneous rate of change**

## Geometric Interpretation

Geometrically, this limit represents the slope of the tangent line to the curve $y = f(x)$ at the point $(x, f(x))$.

As $h$ gets smaller, the secant line connecting $(x, f(x))$ and $(x+h, f(x+h))$ approaches the tangent line at $x$.

## Alternative Notation

The derivative can be written in several equivalent ways:
- $f'(x)$ (Lagrange notation)
- $\frac{df}{dx}$ (Leibniz notation)
- $\frac{d}{dx}f(x)$ (operator notation)
- $Df(x)$ (Euler notation)

All of these mean the same thing: the derivative of $f$ with respect to $x$.
