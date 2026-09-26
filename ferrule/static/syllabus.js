'use strict';

/* The Learn tab: every skill the SAT tests, taught.
 *
 * One entry per skill in College Board's own taxonomy, spelled exactly as the
 * question bank spells it, so each page can show your record on that skill and
 * start a drill of it.
 *
 * All of this is original writing for ferrule -- nothing here is copied from
 * College Board or any prep company. The example passages in Reading and
 * Writing are illustrative, written to show a question type; where they
 * mention studies or findings, those are invented for the example.
 *
 * Most of the length is worked examples and the reason each rule holds,
 * because a page that only names a concept teaches nothing the official
 * skill list does not already say. */

const SYLLABUS = (() => {
  // Small notation helpers: HTML, not MathML, so this file stays readable.
  const fr = (n, d) => `<span class="frac"><span>${n}</span><span>${d}</span></span>`;
  const sq = (x) => `√<span class="rad">${x}</span>`;

  // ------------------------------------------------------------------ Math

  const math = {
    test: 2,
    name: 'Math',
    intro: `44 questions in two modules of 22, with 35 minutes for each module,
      so about 95 seconds a question. The test is adaptive: how you do on the first
      module decides whether the second one is harder or easier. A harder second
      module is the only way to reach the top scores, so module 1 matters most.`,
    format: [
      `<strong>A calculator is allowed on every question.</strong> Desmos is built
        into the test, and a reference sheet of formulas is one click away.`,
      `<strong>About 3 in 4 questions are multiple choice.</strong> The rest ask you
        to type your own answer.`,
      `<strong>Typed answers:</strong> up to 5 characters for a positive answer and 6
        for a negative one (the minus sign counts). Fractions and decimals both work.
        Write a mixed number like 3½ as <span class="m">7/2</span> or
        <span class="m">3.5</span>. If a decimal is too long, round or cut it off to fit.
        Leave out %, $ and commas. If more than one answer is correct, enter just one.`,
      `<strong>The reference sheet gives you:</strong> area of a circle, rectangle and
        triangle; circumference; the Pythagorean theorem; the 30-60-90 and 45-45-90
        triangles; and the volumes of a box, cylinder, sphere, cone and pyramid. It
        also reminds you that a circle is 360° or 2π radians and a triangle's angles
        add to 180°. You do not need to memorise any of those. Everything else on
        these pages you do.`,
    ],
    tips: [
      ['Answer everything', `There is no penalty for a wrong answer. A blank is
        always zero; a guess is sometimes right.`],
      ['Read the last line twice', `Questions often ask for <span class="m">2x</span>,
        <span class="m">x + 1</span>, or "how many more", not <span class="m">x</span>.
        Most careless errors are right working that answers the wrong question.`],
      ['Let Desmos do the algebra', `To solve an equation, type each side as its own
        line and click where the graphs cross. For a system, graph both and click the
        intersection. For a quadratic, click the vertex or the x-intercepts.
        For an unknown constant, type it as a letter and Desmos gives you a slider.`],
      ['Work backwards from the choices', `When the choices are numbers, plug them
        in. Start with a middle value: if it is too big, you know which way to go.`],
      ['Pick your own numbers', `For "which expression is equivalent" questions, choose
        a value like <span class="m">x = 3</span>, work out the original, then work
        out each choice. Only the equivalent one matches. Avoid 0 and 1, which make
        too many expressions agree.`],
      ['Do not get stuck', `If a question has taken two minutes, mark it for review,
        guess, and move on. Every question is worth the same, and the easy one you
        never reached costs as much as the hard one you failed.`],
    ],
    domains: [],
  };

  math.domains.push({
    name: 'Algebra',
    share: 0.35,
    blurb: `Linear equations, linear functions, systems and inequalities. About a
      third of the test, and the most learnable part of it: the same few moves
      solve almost every question.`,
    skills: [
      {
        skill: 'Linear equations in one variable',
        gist: 'Solve for x, count solutions, and solve for an expression without finding x.',
        idea: [
          `An equation is a balance. Whatever you do to one side you do to the other,
            and it stays true. To solve, undo what was done to
            <span class="m">x</span> in reverse order: clear brackets, collect the
            <span class="m">x</span> terms on one side, then divide.`,
          `<strong>Counting solutions.</strong> Any linear equation simplifies to
            <span class="m">ax + b = cx + d</span>. If <span class="m">a ≠ c</span>, the
            <span class="m">x</span> terms do not cancel, so there is exactly one solution.
            If <span class="m">a = c</span>, the <span class="m">x</span> terms cancel and
            you are left with a statement about numbers: if it is true (like 5 = 5), every
            <span class="m">x</span> works, so there are infinitely many solutions. If it is
            false (like 5 = 8), no <span class="m">x</span> works, so there are none.`,
          `<strong>Fractions.</strong> Multiply every term on both sides by the lowest
            common denominator first. The fractions disappear and the rest is routine.`,
        ],
        examples: [
          {
            q: `Solve <span class="m">5(x − 2) + 3 = 2x + 11</span>.`,
            steps: [
              `Distribute: <span class="m">5x − 10 + 3 = 2x + 11</span>.`,
              `Combine: <span class="m">5x − 7 = 2x + 11</span>.`,
              `Subtract <span class="m">2x</span> from both sides: <span class="m">3x − 7 = 11</span>.`,
              `Add 7: <span class="m">3x = 18</span>, so <span class="m">x = 6</span>.`,
              `Check: left side <span class="m">5(4) + 3 = 23</span>; right side
                <span class="m">2(6) + 11 = 23</span>. ✓`,
            ],
            answer: `<span class="m">x = 6</span>`,
          },
          {
            q: `The equation <span class="m">4(3x + k) = 12x − 8</span> has infinitely
              many solutions. What is <span class="m">k</span>?`,
            steps: [
              `Expand the left: <span class="m">12x + 4k = 12x − 8</span>.`,
              `The <span class="m">x</span> terms already match (12 and 12), so they cancel:
                <span class="m">4k = −8</span>.`,
              `For every <span class="m">x</span> to work, this must be true:
                <span class="m">k = −2</span>.`,
              `If the question had asked for <em>no</em> solution, the answer would be any
                <span class="m">k</span> except −2.`,
            ],
            answer: `<span class="m">k = −2</span>`,
          },
          {
            q: `If ${fr('2x', '3')} + 5 = 11, what is the value of <span class="m">4x</span>?`,
            steps: [
              `Subtract 5: ${fr('2x', '3')} = 6.`,
              `Multiply by 3: <span class="m">2x = 18</span>.`,
              `The question wants <span class="m">4x</span>, which is double
                <span class="m">2x</span>: 36. There is no need to find
                <span class="m">x = 9</span> and then multiply back.`,
            ],
            answer: '36',
          },
        ],
        traps: [
          `A minus sign in front of brackets flips every sign inside:
            <span class="m">−(x − 4) = −x + 4</span>, not <span class="m">−x − 4</span>.`,
          `Answering <span class="m">x</span> when the question asked for something
            built from it. One of the wrong choices is almost always the value of
            <span class="m">x</span> itself.`,
        ],
        tips: [
          `In Desmos, type the left side as one line and the right side as another. The
            <span class="m">x</span>-value where they cross is the solution. Parallel
            lines mean no solution; one line on top of the other means infinitely many.`,
          `Substituting your answer back takes ten seconds and catches most sign errors.`,
        ],
      },
      {
        skill: 'Linear equations in two variables',
        gist: 'Write and read equations like 3x + 5y = 60, and find intercepts and slope.',
        idea: [
          `An equation such as <span class="m">3x + 5y = 60</span> describes a
            relationship between two quantities, not a single answer. Every pair
            <span class="m">(x, y)</span> that makes it true is a point on one straight
            line.`,
          `In word problems, each coefficient is a rate: the cost, weight or amount
            <em>per</em> one of that thing. The constant is the total. So if muffins cost
            $3 and cookies $2 and you spend $24, that is <span class="m">3m + 2c = 24</span>.`,
          `<strong>Intercepts:</strong> set <span class="m">x = 0</span> to get the
            <span class="m">y</span>-intercept and <span class="m">y = 0</span> to get the
            <span class="m">x</span>-intercept. <strong>Slope</strong> of
            <span class="m">ax + by = c</span> is <span class="m">−a/b</span>. That comes
            straight from solving for <span class="m">y</span>:
            <span class="m">y = (−a/b)x + c/b</span>.`,
        ],
        examples: [
          {
            q: `Maya earns $12 an hour tutoring and $9 an hour at a café. She wants to earn
              exactly $180 this week. Write the equation, say what 9 means, and find her
              café hours if she tutors for 6 hours.`,
            steps: [
              `Let <span class="m">t</span> be tutoring hours and <span class="m">c</span>
                café hours: <span class="m">12t + 9c = 180</span>.`,
              `9 is the number of dollars she earns for each hour at the café.`,
              `With <span class="m">t = 6</span>: <span class="m">72 + 9c = 180</span>, so
                <span class="m">9c = 108</span> and <span class="m">c = 12</span>.`,
            ],
            answer: '12 hours at the café',
          },
          {
            q: `Find the slope and both intercepts of <span class="m">4x − 6y = 18</span>.`,
            steps: [
              `Solve for <span class="m">y</span>: <span class="m">−6y = −4x + 18</span>, so
                <span class="m">y = </span>${fr('2', '3')}<span class="m">x − 3</span>.`,
              `The slope is ${fr('2', '3')}, which matches <span class="m">−a/b = −4/−6</span>.`,
              `<span class="m">y</span>-intercept: <span class="m">(0, −3)</span>.`,
              `<span class="m">x</span>-intercept: set <span class="m">y = 0</span>, so
                <span class="m">4x = 18</span> and <span class="m">x = 4.5</span>.`,
            ],
            answer: 'slope 2/3, crosses the axes at (0, −3) and (4.5, 0)',
          },
        ],
        traps: [
          `Swapping the variables. Write down what <span class="m">x</span> and
            <span class="m">y</span> stand for before you build the equation.`,
          `Forgetting the minus in <span class="m">−a/b</span>. The line
            <span class="m">2x + 3y = 6</span> slopes <em>down</em>.`,
        ],
        tips: [
          `To test whether a point lies on a line, substitute it. That is quicker than
            graphing.`,
          `Desmos accepts <span class="m">4x − 6y = 18</span> exactly as written. You
            do not need to rearrange before graphing.`,
        ],
      },
      {
        skill: 'Linear functions',
        gist: 'f(x) = mx + b as a rate and a starting value, and building it from points, tables or words.',
        idea: [
          `A linear function changes by the same amount for every step of 1 in the input.
            In <span class="m">f(x) = mx + b</span>, <span class="m">m</span> is that change
            (the rate), and <span class="m">b</span> is the value when
            <span class="m">x = 0</span> (the starting amount).`,
          `<strong>Slope from two points:</strong>
            <span class="m">m = </span>${fr('y₂ − y₁', 'x₂ − x₁')}, change in output over
            change in input. Then put either point into
            <span class="m">y = mx + b</span> to find <span class="m">b</span>.`,
          `<strong>Parallel lines</strong> have the same slope. <strong>Perpendicular
            lines</strong> have slopes that multiply to −1: flip the fraction and change
            the sign, so 2/3 becomes −3/2.`,
          `<strong>In a table</strong>, the function is linear only if equal steps in
            <span class="m">x</span> give equal steps in <span class="m">y</span>.`,
        ],
        examples: [
          {
            q: `A linear function has <span class="m">f(2) = 11</span> and
              <span class="m">f(6) = 23</span>. Find <span class="m">f(10)</span>.`,
            steps: [
              `Slope: ${fr('23 − 11', '6 − 2')} = ${fr('12', '4')} = 3.`,
              `Use one point: <span class="m">11 = 3(2) + b</span>, so <span class="m">b = 5</span>.`,
              `<span class="m">f(x) = 3x + 5</span>, so <span class="m">f(10) = 35</span>.`,
            ],
            answer: '35',
          },
          {
            q: `A 30 cm candle burns down 1.5 cm every hour. Write its height after
              <span class="m">t</span> hours and find when it is 12 cm tall.`,
            steps: [
              `It starts at 30 and loses 1.5 per hour: <span class="m">h(t) = 30 − 1.5t</span>.`,
              `Set <span class="m">30 − 1.5t = 12</span>, so <span class="m">1.5t = 18</span>
                and <span class="m">t = 12</span>.`,
              `Reading the parts: 30 is the height before it is lit, and −1.5 is how much
                it shrinks per hour.`,
            ],
            answer: 'after 12 hours',
          },
          {
            q: `Find the line through <span class="m">(6, 1)</span> that is perpendicular
              to <span class="m">y = −</span>${fr('3', '4')}<span class="m">x + 2</span>.`,
            steps: [
              `The perpendicular slope is the negative reciprocal of −3/4, which is
                ${fr('4', '3')}.`,
              `<span class="m">1 = </span>${fr('4', '3')}<span class="m">(6) + b = 8 + b</span>,
                so <span class="m">b = −7</span>.`,
            ],
            answer: `<span class="m">y = </span>${fr('4', '3')}<span class="m">x − 7</span>`,
          },
        ],
        traps: [
          `Putting run over rise. Slope is change in <span class="m">y</span> divided by
            change in <span class="m">x</span>.`,
          `When <span class="m">x</span> counts years since 2010, the starting value is
            the value <em>in 2010</em>, not in year zero.`,
        ],
        tips: [
          `Given a table? In Desmos, add a table and type
            <span class="m">y₁ ~ mx₁ + b</span>. It fits the line and gives you
            <span class="m">m</span> and <span class="m">b</span> exactly.`,
          `"Increases by 4 each month" is the slope. "Starts at 50" or "a one-time fee
            of 50" is the intercept.`,
        ],
      },
      {
        skill: 'Systems of two linear equations in two variables',
        gist: 'Find where two lines meet, set up two-fact word problems, and control how many solutions there are.',
        idea: [
          `A solution to a system makes both equations true at once, so it is the point
            where the two lines cross. Two different lines cross once, never (they are
            parallel), or they are the same line and share every point.`,
          `<strong>Elimination:</strong> scale one or both equations so that one variable
            has matching coefficients, then add or subtract to remove it.
            <strong>Substitution:</strong> solve one equation for a variable and replace
            it in the other. Use whichever makes less work.`,
          `<strong>How many solutions?</strong> Different slopes means one solution. Same
            slope with a different intercept means none. Same slope and same intercept
            means infinitely many. For <span class="m">ax + by = c</span> and
            <span class="m">dx + ey = f</span>: no solution when
            <span class="m">a/d = b/e</span> but that ratio differs from
            <span class="m">c/f</span>.`,
        ],
        examples: [
          {
            q: `Solve <span class="m">3x + 2y = 16</span> and <span class="m">5x − 2y = 0</span>.`,
            steps: [
              `The <span class="m">y</span> terms are already opposites. Add the equations:
                <span class="m">8x = 16</span>, so <span class="m">x = 2</span>.`,
              `Back-substitute: <span class="m">3(2) + 2y = 16</span>, so
                <span class="m">y = 5</span>.`,
            ],
            answer: '(2, 5)',
          },
          {
            q: `A theatre sold 250 tickets: adult tickets for $12 and student tickets for
              $8. It took in $2,560. How many adult tickets were sold?`,
            steps: [
              `Two unknowns, two facts: <span class="m">a + s = 250</span> (tickets) and
                <span class="m">12a + 8s = 2560</span> (money).`,
              `Multiply the first by 8: <span class="m">8a + 8s = 2000</span>.`,
              `Subtract from the money equation: <span class="m">4a = 560</span>, so
                <span class="m">a = 140</span> and <span class="m">s = 110</span>.`,
              `Check: <span class="m">12(140) + 8(110) = 1680 + 880 = 2560</span>. ✓`,
            ],
            answer: '140 adult tickets',
          },
          {
            q: `For what value of <span class="m">k</span> does this system have no
              solution? <span class="m">6x − ky = 5</span> and <span class="m">3x + 4y = 9</span>.`,
            steps: [
              `No solution means parallel lines, so the coefficients must be in the same
                ratio. The <span class="m">x</span> ratio is 6/3 = 2.`,
              `The <span class="m">y</span> coefficients need the same ratio:
                <span class="m">−k/4 = 2</span>, so <span class="m">k = −8</span>.`,
              `The constants must <em>not</em> share it: 5/9 ≠ 2. ✓ So the lines are
                parallel and distinct.`,
            ],
            answer: '<span class="m">k = −8</span>',
          },
        ],
        traps: [
          `Stopping at <span class="m">x</span> when the question asked for
            <span class="m">y</span>, or for <span class="m">x + y</span>.`,
          `Subtracting one equation from another and forgetting to subtract
            <em>every</em> term, including the constant.`,
        ],
        tips: [
          `If the question asks for <span class="m">x + y</span> or
            <span class="m">x − y</span>, try adding or subtracting the equations as they
            stand. With <span class="m">2x + 3y = 17</span> and
            <span class="m">3x + 2y = 18</span>, adding gives
            <span class="m">5x + 5y = 35</span>, so <span class="m">x + y = 7</span>
            immediately.`,
          `Graph both in Desmos and click the crossing point. It solves any system in
            seconds.`,
        ],
      },
      {
        skill: 'Linear inequalities in one or two variables',
        gist: 'Solve inequalities, translate "at least" and "at most", and read shaded regions.',
        idea: [
          `Solve an inequality exactly like an equation, with one exception: multiplying
            or dividing both sides by a negative number <strong>reverses the sign</strong>.
            The reason: 2 &lt; 5, but −2 &gt; −5. Negating flips the order of numbers.`,
          `<strong>Translating words:</strong> "at least" means ≥, "at most" and "no more
            than" mean ≤, "more than" means &gt;, and "fewer than" means &lt;.`,
          `<strong>Two variables:</strong> <span class="m">y &gt; mx + b</span> is the region
            above the line, and <span class="m">y &lt; mx + b</span> is below it. A dashed
            line means the line itself is not included (&lt; or &gt;). A solid line means it
            is (≤ or ≥). A point is in the solution only if it makes <em>every</em>
            inequality true.`,
        ],
        examples: [
          {
            q: `Solve <span class="m">−3x + 7 ≤ 22</span>.`,
            steps: [
              `Subtract 7: <span class="m">−3x ≤ 15</span>.`,
              `Divide by −3 and flip the sign: <span class="m">x ≥ −5</span>.`,
            ],
            answer: '<span class="m">x ≥ −5</span>',
          },
          {
            q: `A phone plan costs $25 a month plus $0.10 per text. Jordan can spend at
              most $40. What is the greatest number of texts Jordan can send?`,
            steps: [
              `"At most" means ≤: <span class="m">25 + 0.10t ≤ 40</span>.`,
              `<span class="m">0.10t ≤ 15</span>, so <span class="m">t ≤ 150</span>.`,
            ],
            answer: '150 texts',
          },
          {
            q: `Which of <span class="m">(1, 2)</span> and <span class="m">(4, 3)</span>
              satisfies both <span class="m">y &gt; 2x − 3</span> and
              <span class="m">y ≤ −x + 6</span>?`,
            steps: [
              `<span class="m">(1, 2)</span>: is 2 &gt; −1? Yes. Is 2 ≤ 5? Yes. It is in the
                region.`,
              `<span class="m">(4, 3)</span>: is 3 &gt; 5? No. It fails the first
                inequality, so the second does not matter.`,
            ],
            answer: '<span class="m">(1, 2)</span> only',
          },
        ],
        traps: [
          `Forgetting to flip the sign after dividing by a negative. Check with a number:
            does <span class="m">x = 0</span> really satisfy your answer?`,
          `Counting problems want a whole number. If the algebra gives
            <span class="m">t ≤ 12.8</span>, the greatest possible count is 12, not 13.`,
        ],
        tips: [
          `Desmos graphs inequalities with the shading already drawn. Type them in as
            written and see which choice falls inside the overlap.`,
          `With answer choices, testing each point is often faster than solving.`,
        ],
      },
    ],
  });

  math.domains.push({
    name: 'Advanced Math',
    share: 0.35,
    blurb: `Quadratics, exponentials, polynomials and rational expressions: the other
      third of the test. It is where the harder second module goes, so it is worth
      the most practice.`,
    skills: [
      {
        skill: 'Equivalent expressions',
        gist: 'Expand, factor, use exponent rules, and match coefficients.',
        idea: [
          `Two expressions are equivalent when they give the same value for every
            <span class="m">x</span>. You rewrite an expression without changing its
            value by expanding, factoring or applying the exponent rules.`,
          `<strong>Exponent rules</strong> (each follows from counting how many times you
            multiply): <span class="m">aᵐ · aⁿ = aᵐ⁺ⁿ</span>;
            <span class="m">aᵐ / aⁿ = aᵐ⁻ⁿ</span>; <span class="m">(aᵐ)ⁿ = aᵐⁿ</span>;
            <span class="m">a⁰ = 1</span>; <span class="m">a⁻ⁿ = 1/aⁿ</span>;
            <span class="m">a^(1/n)</span> is the <span class="m">n</span>th root; and
            <span class="m">a^(m/n)</span> is the <span class="m">n</span>th root raised to
            the <span class="m">m</span>.`,
          `<strong>Factoring patterns</strong> worth recognising instantly:
            <span class="m">a² − b² = (a − b)(a + b)</span>, and
            <span class="m">(a ± b)² = a² ± 2ab + b²</span>.`,
          `<strong>Matching coefficients.</strong> If two polynomials are equal for all
            <span class="m">x</span>, the coefficients of each power must be equal.
            Expand, line them up, and read off the unknowns.`,
          `<strong>Rational expressions:</strong> you can cancel <em>factors</em>, which
            are things multiplied. You cannot cancel <em>terms</em>, which are things
            added. Factor first, then cancel.`,
        ],
        examples: [
          {
            q: `<span class="m">(ax + 3)(2x − 4) = 6x² − 6x − 12</span> for all
              <span class="m">x</span>. What is <span class="m">a</span>?`,
            steps: [
              `Expand: <span class="m">2ax² − 4ax + 6x − 12</span>.`,
              `Match the <span class="m">x²</span> terms: <span class="m">2a = 6</span>, so
                <span class="m">a = 3</span>.`,
              `Check the <span class="m">x</span> terms: <span class="m">−4(3) + 6 = −6</span>. ✓`,
            ],
            answer: '<span class="m">a = 3</span>',
          },
          {
            q: `Write ${fr('x⁵ · x⁻²', 'x^(1/2)')} as a single power of
              <span class="m">x</span>.`,
            steps: [
              `Top: <span class="m">x⁵ · x⁻² = x³</span>.`,
              `Divide: <span class="m">x³ ÷ x^(1/2) = x^(3 − 1/2) = x^(5/2)</span>.`,
              `This is the same as <span class="m">x²</span>${sq('x')}.`,
            ],
            answer: '<span class="m">x^(5/2)</span>',
          },
          {
            q: `Simplify ${fr('x² − 9', 'x² + 5x + 6')}.`,
            steps: [
              `Factor both: ${fr('(x − 3)(x + 3)', '(x + 2)(x + 3)')}.`,
              `Cancel the shared factor <span class="m">(x + 3)</span>: ${fr('x − 3', 'x + 2')}.`,
            ],
            answer: fr('x − 3', 'x + 2'),
          },
        ],
        traps: [
          `<span class="m">(a + b)² ≠ a² + b²</span>. The middle term
            <span class="m">2ab</span> is the most-missed thing in this skill.`,
          `Cancelling across a plus sign: ${fr('x + 6', 'x')} is not
            <span class="m">6</span>.`,
        ],
        tips: [
          `Pick a number. With <span class="m">x = 2</span>, work out the original and
            each choice. Only the equivalent choice matches.`,
          `In Desmos, graph the original and a choice. If the graphs lie exactly on top
            of each other, they are equivalent.`,
        ],
      },
      {
        skill: 'Nonlinear equations in one variable and systems of equations in two variables',
        gist: 'Solve quadratics, radical and rational equations, and line-and-curve systems.',
        idea: [
          `<strong>Quadratics</strong> <span class="m">ax² + bx + c = 0</span>: factor if you
            can. If you can't, use the quadratic formula,
            <span class="m">x = </span>${fr('−b ± ' + sq('b² − 4ac'), '2a')}.`,
          `<strong>The discriminant</strong> <span class="m">b² − 4ac</span> is the part under
            the root, so it decides how many real solutions there are. If it is positive
            there are two, if it is zero there is one, and if it is negative there are none,
            because you cannot take the square root of a negative number.`,
          `<strong>Shortcuts:</strong> the solutions add up to <span class="m">−b/a</span>
            and multiply to <span class="m">c/a</span>. You can use this without solving.`,
          `<strong>Radical equations:</strong> isolate the root, square both sides, solve,
            then check every answer in the original. Squaring can create
            <em>extraneous</em> solutions that do not really work.`,
          `<strong>Systems with a curve:</strong> set the expressions equal to each other.
            A line and a parabola give a quadratic, and its discriminant says how many
            times they meet.`,
        ],
        examples: [
          {
            q: `Solve <span class="m">x² − 5x − 14 = 0</span>.`,
            steps: [
              `Find two numbers that multiply to −14 and add to −5: −7 and 2.`,
              `<span class="m">(x − 7)(x + 2) = 0</span>, so <span class="m">x = 7</span> or
                <span class="m">x = −2</span>.`,
            ],
            answer: '7 and −2',
          },
          {
            q: `For what value of <span class="m">c</span> does
              <span class="m">x² + 6x + c = 0</span> have exactly one real solution?`,
            steps: [
              `One solution means the discriminant is 0: <span class="m">6² − 4(1)(c) = 0</span>.`,
              `<span class="m">36 − 4c = 0</span>, so <span class="m">c = 9</span>.`,
              `Check: <span class="m">x² + 6x + 9 = (x + 3)²</span>, which is zero only at −3. ✓`,
            ],
            answer: '<span class="m">c = 9</span>',
          },
          {
            q: `Solve ${sq('x + 7')} <span class="m">= x − 5</span>.`,
            steps: [
              `Square both sides: <span class="m">x + 7 = x² − 10x + 25</span>.`,
              `Rearrange: <span class="m">x² − 11x + 18 = 0</span>, so
                <span class="m">(x − 9)(x − 2) = 0</span>.`,
              `Check <span class="m">x = 9</span>: ${sq('16')} = 4 and 9 − 5 = 4. ✓`,
              `Check <span class="m">x = 2</span>: ${sq('9')} = 3, but 2 − 5 = −3. They do not
                match, so 2 is extraneous.`,
            ],
            answer: '<span class="m">x = 9</span> only',
          },
          {
            q: `How many points do <span class="m">y = x² − 4x + 1</span> and
              <span class="m">y = 2x − 8</span> share?`,
            steps: [
              `Set them equal: <span class="m">x² − 4x + 1 = 2x − 8</span>, so
                <span class="m">x² − 6x + 9 = 0</span>.`,
              `That is <span class="m">(x − 3)² = 0</span>: one solution. The line just
                touches the parabola at <span class="m">(3, −2)</span>.`,
            ],
            answer: 'one point, (3, −2)',
          },
        ],
        traps: [
          `Dividing both sides by <span class="m">x</span> throws away the solution
            <span class="m">x = 0</span>. Factor it out instead:
            <span class="m">x² = 5x</span> becomes <span class="m">x(x − 5) = 0</span>.`,
          `Skipping the check on radical and rational equations.`,
        ],
        tips: [
          `Asked for the sum of the solutions? It is <span class="m">−b/a</span>. Do not
            solve.`,
          `In Desmos, graph <span class="m">y = </span>(left side) and
            <span class="m">y = </span>(right side) and click the crossings. Extraneous
            solutions simply do not appear.`,
        ],
      },
      {
        skill: 'Nonlinear functions',
        gist: 'Read quadratic and exponential functions from their equations, graphs and stories.',
        idea: [
          `<strong>Three forms of a quadratic</strong>, each showing something different:`,
          `<ul>
            <li><span class="m">f(x) = ax² + bx + c</span> gives the
              <span class="m">y</span>-intercept <span class="m">c</span>, and the vertex
              is at <span class="m">x = −b/(2a)</span>.</li>
            <li><span class="m">f(x) = a(x − h)² + k</span> gives the vertex
              <span class="m">(h, k)</span>. Mind the sign: <span class="m">(x − 3)</span>
              means <span class="m">h = 3</span>.</li>
            <li><span class="m">f(x) = a(x − p)(x − q)</span> gives the
              <span class="m">x</span>-intercepts <span class="m">p</span> and
              <span class="m">q</span>. The vertex sits halfway between them.</li>
          </ul>
          If <span class="m">a &gt; 0</span> the parabola opens upward and the vertex is a
          minimum; if <span class="m">a &lt; 0</span> it is a maximum.`,
          `<strong>Exponential</strong> <span class="m">f(t) = a · bᵗ</span>:
            <span class="m">a</span> is the starting amount and <span class="m">b</span> is
            what you multiply by each period. Growth of <span class="m">r</span> percent is
            <span class="m">b = 1 + r</span>. Decay of <span class="m">r</span> percent is
            <span class="m">b = 1 − r</span>, because losing 15% leaves 85%. "Doubles every
            3 years" is <span class="m">a · 2^(t/3)</span>.`,
          `<strong>Linear or exponential?</strong> Linear adds the same amount each step.
            Exponential multiplies by the same factor each step.`,
        ],
        examples: [
          {
            q: `For <span class="m">f(x) = 2(x − 3)² − 8</span>, find the vertex, the
              minimum value, the <span class="m">x</span>-intercepts and the
              <span class="m">y</span>-intercept.`,
            steps: [
              `Vertex form, so the vertex is <span class="m">(3, −8)</span>.
                <span class="m">a = 2 &gt; 0</span>, so −8 is the minimum.`,
              `<span class="m">x</span>-intercepts: <span class="m">2(x − 3)² = 8</span>, so
                <span class="m">(x − 3)² = 4</span>, giving <span class="m">x − 3 = ±2</span>,
                so <span class="m">x = 1</span> or <span class="m">x = 5</span>.`,
              `<span class="m">y</span>-intercept: <span class="m">f(0) = 2(9) − 8 = 10</span>.`,
            ],
            answer: 'vertex (3, −8); crosses at x = 1, x = 5 and y = 10',
          },
          {
            q: `A town of 1,200 people grows by 5% a year. Write the model and find the
              population after 2 years.`,
            steps: [
              `Growing 5% means multiplying by 1.05 each year:
                <span class="m">P(t) = 1200(1.05)ᵗ</span>.`,
              `<span class="m">P(2) = 1200 × 1.1025 = 1323</span>.`,
            ],
            answer: '1,323',
          },
          {
            q: `A car bought for $24,000 loses 15% of its value each year. What does 0.85
              mean in <span class="m">V(t) = 24000(0.85)ᵗ</span>?`,
            steps: [
              `Each year the car keeps 100% − 15% = 85% of the previous year's value.`,
              `So 0.85 is the fraction of its value the car keeps each year. It is not the
                amount it loses.`,
            ],
            answer: 'it keeps 85% of its value each year',
          },
          {
            q: `Find the vertex of <span class="m">y = x² − 8x + 5</span>.`,
            steps: [
              `Halve the middle coefficient and square it: (−8/2)² = 16.`,
              `<span class="m">x² − 8x + 16 − 16 + 5 = (x − 4)² − 11</span>.`,
              `Or use <span class="m">x = −b/(2a) = 8/2 = 4</span>, then
                <span class="m">y = 16 − 32 + 5 = −11</span>.`,
            ],
            answer: '(4, −11)',
          },
        ],
        traps: [
          `A 20% decrease is × 0.8, not × 0.2.`,
          `Vertex form <span class="m">(x + 2)²</span> means <span class="m">h = −2</span>.`,
          `Mixing time units. If the rate is per month and <span class="m">t</span> is in
            years, the exponent is <span class="m">12t</span>.`,
        ],
        tips: [
          `In Desmos, click a parabola and its vertex and intercepts light up with exact
            coordinates.`,
          `For "which form shows the maximum" questions, pick the vertex form. For
            "which shows the zeros", pick the factored form.`,
        ],
      },
    ],
  });

  math.domains.push({
    name: 'Problem-Solving and Data Analysis',
    share: 0.15,
    blurb: `Ratios, percentages, statistics and probability, mostly in real-world
      settings. The mathematics is light; reading exactly what is being compared is
      the skill.`,
    skills: [
      {
        skill: 'Ratios, rates, proportional relationships, and units',
        gist: 'Proportions, unit conversions, rates and ratio parts.',
        idea: [
          `<strong>Proportions:</strong> line up the units on both sides, so it is cups
            over dozens on the left and cups over dozens on the right. Then
            cross-multiply.`,
          `<strong>Unit conversion</strong> is multiplying by 1 in disguise. 1000 m/1 km
            equals 1, so multiplying by it changes the units without changing the
            amount. Arrange each fraction so the unit you do not want cancels.`,
          `<strong>Squared and cubed units</strong> convert by the square or cube of the
            factor. 1 yard is 3 feet, so 1 square yard is 3 × 3 = 9 square feet.`,
          `<strong>Ratios as parts:</strong> 3 : 5 means 8 equal parts in all. Divide the
            total by the number of parts to find one part.`,
        ],
        examples: [
          {
            q: `A recipe uses 3 cups of flour for 2 dozen cookies. How much flour is
              needed for 5 dozen?`,
            steps: [
              `${fr('3 cups', '2 dozen')} = ${fr('x cups', '5 dozen')}.`,
              `<span class="m">2x = 15</span>, so <span class="m">x = 7.5</span>.`,
            ],
            answer: '7.5 cups',
          },
          {
            q: `Convert 72 km/h to metres per second.`,
            steps: [
              `72 ${fr('km', 'h')} × ${fr('1000 m', '1 km')} × ${fr('1 h', '3600 s')}.`,
              `km and h cancel: <span class="m">72000 / 3600 = 20</span>.`,
            ],
            answer: '20 m/s',
          },
          {
            q: `A room is 12 ft by 15 ft. Carpet costs $3 per square yard. What does it
              cost to carpet the room?`,
            steps: [
              `Area: <span class="m">12 × 15 = 180</span> square feet.`,
              `1 square yard = 9 square feet, so 180 ÷ 9 = 20 square yards.`,
              `20 × $3 = $60.`,
            ],
            answer: '$60',
          },
          {
            q: `A class of 64 has boys and girls in the ratio 3 : 5. How many girls?`,
            steps: [
              `3 + 5 = 8 parts, and 64 ÷ 8 = 8 students per part.`,
              `Girls are 5 parts: 5 × 8 = 40.`,
            ],
            answer: '40',
          },
        ],
        traps: [
          `Dividing 180 by 3 instead of 9 when converting square feet to square yards.`,
          `Flipping a ratio: "3 boys to 5 girls" is not 3/5 of the class.`,
        ],
        tips: [
          `Write the units next to every number and cancel them like factors. If the
            leftover unit is not the one you want, the setup is wrong. That is a free
            check.`,
        ],
      },
      {
        skill: 'Percentages',
        gist: 'Percent of, percent change, successive changes and working back to the original.',
        idea: [
          `Percent means "per hundred": 35% is 0.35.`,
          `<strong>Use multipliers.</strong> Increasing by <span class="m">p</span>% is
            multiplying by <span class="m">(1 + p/100)</span>. Decreasing by
            <span class="m">p</span>% is multiplying by <span class="m">(1 − p/100)</span>.
            Several changes in a row multiply. They do not add.`,
          `<strong>Percent change</strong> = ${fr('new − original', 'original')} × 100.
            Always divide by the <em>starting</em> value.`,
          `<strong>Working backwards:</strong> if the new value is the original times a
            multiplier, then the original is the new value divided by it.`,
        ],
        examples: [
          {
            q: `An $80 jacket is 25% off, then 8% sales tax is added. What do you pay?`,
            steps: [
              `25% off leaves 75%: <span class="m">80 × 0.75 = 60</span>.`,
              `Tax adds 8%: <span class="m">60 × 1.08 = 64.80</span>.`,
            ],
            answer: '$64.80',
          },
          {
            q: `A price rises 20% and then falls 20%. What is the overall change?`,
            steps: [
              `<span class="m">1.20 × 0.80 = 0.96</span>.`,
              `The price ends at 96% of where it started. The fall is 20% of a
                <em>bigger</em> number than the rise was.`,
            ],
            answer: 'a 4% decrease, not zero',
          },
          {
            q: `After a 15% raise, a salary is $46,000. What was it before?`,
            steps: [
              `<span class="m">original × 1.15 = 46000</span>.`,
              `<span class="m">46000 ÷ 1.15 = 40000</span>.`,
            ],
            answer: '$40,000',
          },
          {
            q: `30 is what percent of 120? And 120 is what percent more than 30?`,
            steps: [
              `30/120 = 0.25, which is 25%.`,
              `Percent more: (120 − 30)/30 = 3, which is 300%.`,
            ],
            answer: '25%, and 300% more',
          },
        ],
        traps: [
          `Dividing by the new value instead of the original in percent change.`,
          `Taking 15% off $46,000 to undo a 15% raise. That gives $39,100, not $40,000.`,
        ],
        tips: [
          `When no amount is given, start with 100. Percentages of 100 are just the
            number itself.`,
        ],
      },
      {
        skill: 'One-variable data: Distributions and measures of center and spread',
        gist: 'Mean, median, spread, outliers, and reading frequency tables and plots.',
        idea: [
          `<strong>Mean</strong> = total ÷ count. So total = mean × count, which is the
            fact most mean questions really turn on. <strong>Median</strong> is the middle
            value once sorted, or the average of the two middle values when there is an
            even number.`,
          `<strong>Outliers</strong> drag the mean towards them, but the median barely
            moves. That is why the median describes skewed data such as incomes better.`,
          `<strong>Spread:</strong> range is largest minus smallest. Standard deviation
            measures how far values typically sit from the mean. You compare it, never
            compute it: tightly packed data has a small standard deviation.`,
          `Adding the same number to every value shifts the mean and median but leaves
            the spread unchanged.`,
        ],
        examples: [
          {
            q: `For 4, 7, 7, 9, 13, 20, find the mean and median. Then replace 20 with 50.`,
            steps: [
              `Mean: 60 ÷ 6 = 10. Median: the middle two are 7 and 9, so the median is 8.`,
              `With 50: the total is 90, so the mean is 15. The median is still 8, because
                the middle values did not change.`,
            ],
            answer: 'the mean jumps from 10 to 15; the median stays at 8',
          },
          {
            q: `Quiz scores: 3 students scored 1, 5 scored 2, 8 scored 3, and 4 scored 4.
              Find the mean and median.`,
            steps: [
              `20 students. Total points: 3(1) + 5(2) + 8(3) + 4(4) = 53. Mean: 53 ÷ 20 = 2.65.`,
              `The median is the average of the 10th and 11th scores. Counting up: scores
                1 to 3 are 1s, 4 to 8 are 2s, 9 to 16 are 3s. So the 10th and 11th are both
                3.`,
            ],
            answer: 'mean 2.65, median 3',
          },
          {
            q: `After five tests, Ana's mean is 84. What does she need on the sixth to
              raise her mean to 86?`,
            steps: [
              `Points so far: 84 × 5 = 420. Points needed: 86 × 6 = 516.`,
              `516 − 420 = 96.`,
            ],
            answer: '96',
          },
        ],
        traps: [
          `Finding the median without sorting first.`,
          `In a frequency table, averaging the frequencies instead of the values.`,
        ],
        tips: [
          `Two sets with the same mean: the one whose values huddle closer to the middle
            has the smaller standard deviation. For example, {48, 50, 52} versus
            {30, 50, 70}.`,
        ],
      },
      {
        skill: 'Two-variable data: Models and scatterplots',
        gist: 'Lines of best fit, predictions, residuals and choosing a model.',
        idea: [
          `A line of best fit summarises a trend. Its slope reads as "for each extra 1
            unit of <span class="m">x</span>, the <em>predicted</em>
            <span class="m">y</span> goes up by <span class="m">m</span>". The word
            <em>predicted</em> matters: real points scatter around the line.`,
          `<strong>Residual</strong> = actual − predicted. A positive residual means the
            point sits above the line.`,
          `<strong>Shape:</strong> points rising by roughly equal steps suggest a linear
            model. Points that multiply, such as doubling, suggest an exponential model.
            A curve with a peak or dip suggests a quadratic.`,
        ],
        examples: [
          {
            q: `A model <span class="m">y = 2.4x + 15</span> predicts a plant's height in cm
              after <span class="m">x</span> weeks. Interpret 2.4, predict week 10, and
              find the residual if the plant is actually 36 cm then.`,
            steps: [
              `2.4 is the predicted growth in cm per week.`,
              `Week 10: <span class="m">2.4(10) + 15 = 39</span> cm.`,
              `Residual: 36 − 39 = −3. The plant is 3 cm below the model's prediction.`,
            ],
            answer: 'predicted 39 cm; residual −3 cm',
          },
          {
            q: `Data: (0, 3), (1, 6), (2, 12), (3, 24). Which model fits?`,
            steps: [
              `Each <span class="m">y</span> is double the one before, a constant ratio,
                so the model is exponential.`,
              `It starts at 3 and multiplies by 2: <span class="m">y = 3 · 2ˣ</span>.`,
            ],
            answer: '<span class="m">y = 3 · 2ˣ</span>',
          },
        ],
        traps: [
          `Treating a prediction as a fact about an individual point.`,
          `Getting the residual's sign backwards. It is actual minus predicted.`,
        ],
        tips: [
          `Given data in a table, Desmos fits it for you: <span class="m">y₁ ~ mx₁ + b</span>
            for a line, or <span class="m">y₁ ~ a·bˣ¹</span> for an exponential.`,
        ],
      },
      {
        skill: 'Probability and conditional probability',
        gist: 'Probability from counts, two-way tables and "given that".',
        idea: [
          `Probability = ${fr('outcomes you want', 'all equally likely outcomes')}.`,
          `<strong>Conditional probability</strong>, meaning "given that", shrinks the
            world to the group you are told about. That group's total becomes the
            denominator. Everything outside it is ignored.`,
          `For two events that do not affect each other, multiply their probabilities.
            If the first draw changes what is left, as with drawing without
            replacement, update the counts for the second draw.`,
        ],
        examples: [
          {
            q: `200 students were surveyed:<br>
              <table class="mini"><tr><th></th><th>Plays a sport</th><th>Doesn't</th><th>Total</th></tr>
              <tr><td>Grade 11</td><td>48</td><td>52</td><td>100</td></tr>
              <tr><td>Grade 12</td><td>36</td><td>64</td><td>100</td></tr>
              <tr><td>Total</td><td>84</td><td>116</td><td>200</td></tr></table>
              Find P(plays a sport), P(grade 12 given plays a sport), and P(plays a sport
              given grade 12).`,
            steps: [
              `P(plays) = 84/200 = 0.42.`,
              `Given "plays a sport", the world is the 84 players, and 36 of them are in
                grade 12: 36/84 = 3/7 ≈ 0.43.`,
              `Given "grade 12", the world is those 100 students, and 36 of them play:
                36/100 = 0.36.`,
            ],
            answer: '0.42, 3/7, and 0.36. The last two differ only in their denominator.',
          },
          {
            q: `A bag holds 5 red, 3 blue and 2 green marbles. Two are drawn without
              replacement. What is the probability both are red?`,
            steps: [
              `First draw: 5/10.`,
              `One red is gone, leaving 4 red of 9: 4/9.`,
              `(5/10) × (4/9) = 20/90 = 2/9.`,
            ],
            answer: '2/9',
          },
        ],
        traps: [
          `Using the grand total as the denominator on a "given that" question.`,
        ],
        tips: [
          `Circle the words after "given that". Their row or column total is your
            denominator.`,
        ],
      },
      {
        skill: 'Inference from sample statistics and margin of error',
        gist: 'What a random sample and its margin of error do, and do not, let you conclude.',
        idea: [
          `A <strong>random sample</strong> lets you estimate something about the
            population it was drawn from, and only that population.`,
          `<strong>Margin of error:</strong> the estimate ± the margin gives a range of
            plausible values for the whole population. It is not a guarantee, and it says
            nothing about individuals.`,
          `<strong>Bigger samples give smaller margins</strong>, because random flukes
            average out. More variable data gives larger margins. A margin of error
            cannot fix a biased sample: surveying only gym members about exercise is
            wrong however many you ask.`,
        ],
        examples: [
          {
            q: `A random sample of 400 of a town's 12,000 residents finds 35% support a new
              park, with a margin of error of 4 percentage points. What can you
              conclude?`,
            steps: [
              `Plausible range for the town: 35% − 4% to 35% + 4%, which is 31% to 39%.`,
              `As people: 0.35 × 12000 = 4,200 is the best estimate, with a plausible range
                of 3,720 to 4,680.`,
              `Valid: "It is plausible that between 31% and 39% of residents support the
                park."`,
              `Not valid: "exactly 35% support it", or anything about a different town.`,
            ],
            answer: 'between 31% and 39% of this town is plausible',
          },
        ],
        traps: [
          `Extending the conclusion beyond the population that was actually sampled.`,
          `Choosing the answer that sounds most certain. Correct answers here use words
            like "plausible" and "likely".`,
        ],
        tips: [
          `If a choice says the margin of error would shrink with a smaller sample,
            eliminate it.`,
        ],
      },
      {
        skill: 'Evaluating statistical claims: Observational studies and experiments',
        gist: 'When a study shows cause, and who its results apply to.',
        idea: [
          `Ask two separate questions of every study:`,
          `<ul>
            <li><strong>Was the treatment randomly assigned?</strong> Only then can you
              conclude cause and effect. Random assignment spreads every other difference
              between people evenly across the groups, so the treatment is the only
              systematic difference left.</li>
            <li><strong>Were the subjects randomly selected from a population?</strong>
              Only then can you generalise to that population.</li>
          </ul>`,
          `An <strong>observational study</strong> assigns nothing: it watches what people
            already do. It can show an association, never a cause. Something else, a
            confounding variable, might drive both.`,
        ],
        examples: [
          {
            q: `200 volunteers are randomly assigned to use a sleep app or not. The app
              group sleeps longer on average. What can be concluded?`,
            steps: [
              `Random assignment, so the app likely <em>caused</em> the extra sleep.`,
              `Volunteers, not a random sample, so it applies to people like these
                volunteers, not to all adults.`,
            ],
            answer: 'cause, but only for people like the volunteers',
          },
          {
            q: `A survey finds students who eat breakfast have higher grades. Does
              breakfast raise grades?`,
            steps: [
              `No one was assigned to eat breakfast, so this is observational.`,
              `There is an association only. Students with more settled home routines
                might both eat breakfast and study more.`,
            ],
            answer: 'no causal conclusion',
          },
        ],
        traps: [
          `Treating a large sample size as a substitute for randomness. It is not.`,
        ],
        tips: [
          `Random assignment lets you conclude cause; random selection lets you
            generalise. Check for each one separately.`,
        ],
      },
    ],
  });

  math.domains.push({
    name: 'Geometry and Trigonometry',
    share: 0.15,
    blurb: `Area, volume, angles, triangles, trigonometry and circles. Most formulas
      are on the reference sheet. What is tested is knowing which one applies and
      how shapes scale.`,
    skills: [
      {
        skill: 'Area and volume',
        gist: 'Formulas, composite shapes, and how area and volume scale.',
        idea: [
          `The reference sheet has every area and volume formula you need. The skill is
            breaking a shape into pieces you know, then adding or subtracting.`,
          `<strong>Scaling</strong> is the most tested idea. Multiply every length by
            <span class="m">k</span> and the area is multiplied by
            <span class="m">k²</span>, because area has two length directions. The volume
            is multiplied by <span class="m">k³</span>, because volume has three.`,
        ],
        examples: [
          {
            q: `A cylinder has radius 3 and height 10. Find its volume, then its volume
              with the radius doubled.`,
            steps: [
              `<span class="m">V = πr²h = π(9)(10) = 90π</span>.`,
              `Doubling <span class="m">r</span> multiplies <span class="m">r²</span> by 4:
                <span class="m">360π</span>.`,
            ],
            answer: '90π, then 360π',
          },
          {
            q: `Two similar cones have heights in the ratio 2 : 3. The smaller has volume
              40. What is the larger one's volume?`,
            steps: [
              `The length scale is 3/2, so volume scales by (3/2)³ = 27/8.`,
              `<span class="m">40 × 27/8 = 135</span>.`,
            ],
            answer: '135',
          },
          {
            q: `A cube has volume 64. What is its surface area?`,
            steps: [
              `Side: the cube root of 64 is 4.`,
              `6 faces, each 4 × 4 = 16, so 96 in total.`,
            ],
            answer: '96',
          },
        ],
        traps: [
          `Using the diameter where the formula wants the radius.`,
          `Forgetting the 1/3 in cone and pyramid volumes, or the 4/3 in a sphere's.`,
        ],
        tips: [
          `Leave answers in terms of π until the end. The choices usually are.`,
        ],
      },
      {
        skill: 'Lines, angles, and triangles',
        gist: 'Angle rules, parallel lines, triangle facts and similar triangles.',
        idea: [
          `<ul>
            <li>Vertical angles (opposite at a crossing) are equal. Angles on a straight
              line add to 180°.</li>
            <li>A line crossing two <strong>parallel lines</strong> makes only two sizes
              of angle. Every acute one is equal, every obtuse one is equal, and an acute
              plus an obtuse makes 180°.</li>
            <li>A triangle's angles add to 180°. An exterior angle equals the sum of the
              two interior angles not next to it.</li>
            <li>Polygon interior angles total <span class="m">(n − 2) × 180°</span>, since
              the shape splits into <span class="m">n − 2</span> triangles.</li>
            <li><strong>Similar triangles</strong> have the same angles, and their
              corresponding sides share one ratio. Two matching angles are enough to
              prove it.</li>
          </ul>`,
        ],
        examples: [
          {
            q: `A triangle's exterior angle is 130°. One of the two far interior angles is
              55°. Find the other.`,
            steps: [`The exterior angle equals the sum of the two far angles:
              <span class="m">130 − 55 = 75</span>.`],
            answer: '75°',
          },
          {
            q: `In triangle ABC, segment DE is parallel to BC, with D on AB and E on AC.
              AD = 4, DB = 6 and DE = 5. Find BC.`,
            steps: [
              `DE ∥ BC, so triangle ADE is similar to triangle ABC.`,
              `Match whole sides: AD/AB = DE/BC, where AB = 4 + 6 = 10.`,
              `4/10 = 5/BC, so BC = 12.5.`,
            ],
            answer: '12.5',
          },
          {
            q: `A triangle with sides 6, 8 and 10 is similar to one whose shortest side is
              15. Find the other two sides.`,
            steps: [`The scale is 15/6 = 2.5, so the sides are 8 × 2.5 = 20 and 10 × 2.5 = 25.`],
            answer: '20 and 25',
          },
        ],
        traps: [
          `Using DB instead of the whole side AB in a similar-triangle ratio.`,
        ],
        tips: [
          `Write every angle you can find onto the figure. The one you need usually
            appears three steps later.`,
        ],
      },
      {
        skill: 'Right triangles and trigonometry',
        gist: 'Pythagoras, special triangles, SOH-CAH-TOA, complementary angles and radians.',
        idea: [
          `<strong>Pythagoras:</strong> <span class="m">a² + b² = c²</span>. Learn the common
            triples and their multiples: 3-4-5, 5-12-13, 8-15-17 and 7-24-25.`,
          `<strong>Special triangles</strong> (also on the reference sheet): 45-45-90 has
            sides <span class="m">s, s, s</span>${sq('2')}, and 30-60-90 has sides
            <span class="m">x, x</span>${sq('3')}<span class="m">, 2x</span>.`,
          `<strong>SOH-CAH-TOA:</strong> sine = opposite/hypotenuse, cosine =
            adjacent/hypotenuse, tangent = opposite/adjacent.`,
          `<strong>Complementary angles:</strong> <span class="m">sin x = cos(90° − x)</span>.
            In a right triangle, the side opposite one acute angle is adjacent to the
            other, so each angle's sine is the other's cosine. This fact is tested
            constantly.`,
          `<strong>Radians:</strong> π radians = 180°. Multiply by π/180 to convert
            degrees to radians.`,
        ],
        examples: [
          {
            q: `In right triangle ABC with right angle C, <span class="m">sin A = 5/13</span>.
              Find cos A, tan A and cos B.`,
            steps: [
              `Opposite 5, hypotenuse 13, so the adjacent side is 12 (a 5-12-13 triangle).`,
              `cos A = 12/13 and tan A = 5/12.`,
              `cos B = sin A = 5/13, because A and B are complementary.`,
            ],
            answer: 'cos A = 12/13, tan A = 5/12, cos B = 5/13',
          },
          {
            q: `A 30-60-90 triangle has hypotenuse 14. Find its legs.`,
            steps: [`The hypotenuse is <span class="m">2x</span>, so the short leg is 7 and
              the long leg is <span class="m">7</span>${sq('3')}.`],
            answer: '7 and 7√3',
          },
          {
            q: `A 20 ft ladder leans against a wall at 60° to the ground. How high up the
              wall does it reach?`,
            steps: [
              `The height is opposite the 60° angle and the ladder is the hypotenuse:
                <span class="m">h = 20 sin 60°</span>.`,
              `<span class="m">= 20 × </span>${sq('3')}<span class="m">/2 = 10</span>${sq('3')}, about 17.3 ft.`,
            ],
            answer: '10√3 ≈ 17.3 ft',
          },
          {
            q: `Convert 135° to radians.`,
            steps: [`<span class="m">135 × π/180 = 3π/4</span>.`],
            answer: '3π/4',
          },
        ],
        traps: [
          `Desmos works in radians until you switch it. Use the wrench icon to set
            degrees before any degree question, or sin 60 will give a wrong number.`,
        ],
        tips: [
          `If you know one trig ratio, sketch the triangle and label two sides. Every
            other ratio can then be read straight off it.`,
        ],
      },
      {
        skill: 'Circles',
        gist: 'Arcs, sectors, angles in circles, and the equation of a circle.',
        idea: [
          `<strong>Parts of the whole:</strong> an arc or sector takes the same fraction of
            the circle as its central angle takes of 360°. Arc length =
            (θ/360) × 2πr. Sector area = (θ/360) × πr². In radians, arc length is simply
            <span class="m">rθ</span>.`,
          `An inscribed angle, with its vertex on the circle, is half the central angle
            that cuts off the same arc. A tangent line meets the radius at 90°.`,
          `<strong>Equation:</strong> <span class="m">(x − h)² + (y − k)² = r²</span> has
            centre <span class="m">(h, k)</span> and radius <span class="m">r</span>. If it
            is expanded, complete the square in <span class="m">x</span> and in
            <span class="m">y</span> to get back to this form.`,
        ],
        examples: [
          {
            q: `Find the centre and radius of
              <span class="m">x² + y² − 6x + 10y + 9 = 0</span>.`,
            steps: [
              `Group: <span class="m">(x² − 6x) + (y² + 10y) = −9</span>.`,
              `Complete each square, adding 9 and 25 to both sides:
                <span class="m">(x − 3)² + (y + 5)² = −9 + 9 + 25 = 25</span>.`,
              `Centre <span class="m">(3, −5)</span>, and radius √25 = 5.`,
            ],
            answer: 'centre (3, −5), radius 5',
          },
          {
            q: `A circle has radius 9. Find the arc length and sector area for an 80°
              central angle.`,
            steps: [
              `The fraction of the circle is 80/360 = 2/9.`,
              `Arc: (2/9) × 18π = 4π. Sector: (2/9) × 81π = 18π.`,
            ],
            answer: 'arc 4π, sector 18π',
          },
          {
            q: `An arc of length 6π is on a circle of radius 8. What is its central angle
              in radians?`,
            steps: [`<span class="m">θ = arc/r = 6π/8 = 3π/4</span>.`],
            answer: '3π/4',
          },
        ],
        traps: [
          `The equation gives <span class="m">r²</span>. A 25 on the right means a radius
            of 5.`,
          `The signs flip: <span class="m">(y + 5)</span> means the centre's
            <span class="m">y</span> is −5.`,
        ],
        tips: [
          `Paste an expanded circle equation into Desmos. Clicking the curve shows its
            points, and the centre is easy to read off.`,
        ],
      },
    ],
  });

  // ------------------------------------------------------------------ Reading and Writing

  const choice = (letter, text, why, right = false) =>
    `<li class="${right ? 'right' : ''}"><strong>${letter}</strong> ${text}<span class="why">${why}</span></li>`;
  const choices = (...items) => `<ol class="opts">${items.join('')}</ol>`;

  const rw = {
    test: 1,
    name: 'Reading and Writing',
    intro: `54 questions in two modules of 27, with 32 minutes for each module, so
      about 71 seconds a question. Every question has its own short passage of 25 to
      150 words, sometimes a pair of passages, and asks one thing about it. Like
      Math, it is adaptive: module 1 decides how hard module 2 is.`,
    format: [
      `<strong>No long passages.</strong> You never hold a 700-word essay in your head.
        Each passage is short, so precise reading beats speed reading.`,
      `<strong>Four kinds of question:</strong> meaning (words in context, purpose,
        comparing two texts), evidence and inference, grammar and punctuation, and
        editing (transitions, and using notes to meet a goal).`,
      `<strong>You can move around within a module.</strong> Use Mark for Review, and
        come back to anything slow.`,
    ],
    tips: [
      ['Read the question first', `It tells you what to look for, so you read the
        passage once with a purpose instead of twice.`],
      ['Predict, then match', `Before you look at the choices, answer in your own
        words. Then find the choice that says the same thing. Wrong choices are built
        to sound good to someone who has not decided what they are looking for.`],
      ['The text is the only authority', `The right answer is supported by the
        passage, not by what you know or by what is generally true. If you cannot
        point to the words that prove it, it is not the answer.`],
      ['Half right is all wrong', `A choice that starts well and then adds one
        unsupported claim is wrong. Read every choice to its last word.`],
      ['Bank time on grammar', `Punctuation and grammar questions take 20 to 30
        seconds once you know the rules. The time you save pays for the harder
        evidence questions.`],
    ],
    domains: [],
  };

  rw.domains.push({
    name: 'Craft and Structure',
    share: 0.28,
    blurb: `What words mean in context, why a text is built the way it is, and how two
      texts relate.`,
    skills: [
      {
        skill: 'Words in Context',
        gist: 'Choose the word that means exactly what the sentence needs.',
        idea: [
          `These questions test meaning in context, not vocabulary for its own sake. The
            sentence always contains clues that decide what the blank must mean:`,
          `<ul>
            <li><strong>Contrast</strong> (although, but, however, despite): the blank
              means the opposite of something nearby.</li>
            <li><strong>Continuation</strong> (and, also, a colon, "in fact"): the blank
              agrees with or extends what came before.</li>
            <li><strong>Definition:</strong> the next phrase often explains the blank
              outright.</li>
          </ul>`,
          `Common words often carry a <strong>second meaning</strong> that is the one
            tested: <em>novel</em> meaning new, <em>check</em> meaning restrain,
            <em>qualified</em> meaning limited.`,
        ],
        examples: [
          {
            q: `<blockquote>Although the committee's first report was ______, offering only a
              few vague recommendations, its second report laid out a detailed,
              step-by-step plan.</blockquote>
              Which choice completes the text with the most logical and precise word?
              ${choices(
                choice('A', 'cursory', '"Hasty and not thorough" matches "only a few vague recommendations".', true),
                choice('B', 'exhaustive', 'The opposite: that describes the second report.'),
                choice('C', 'controversial', 'Nothing in the text says anyone objected.'),
                choice('D', 'persuasive', 'The contrast is about detail, not about convincing anyone.'),
              )}`,
            steps: [
              `"Although" signals a contrast between the two reports.`,
              `The first report is defined right after the blank: "only a few vague
                recommendations".`,
              `Predict a word like "thin" or "sketchy" before you look. That points to
                <em>cursory</em>.`,
            ],
            answer: 'A',
          },
          {
            q: `<blockquote>The biologist's claim was met with doubt at first, but a decade of
              field data eventually ______ it.</blockquote>
              ${choices(
                choice('A', 'qualified', 'Limiting the claim does not answer the doubt.'),
                choice('B', 'vindicated', 'Proved it right, which is what data answering doubt would do.', true),
                choice('C', 'complicated', 'The wrong direction for "but ... eventually".'),
                choice('D', 'abandoned', 'Data cannot abandon a claim, and the direction is wrong anyway.'),
              )}`,
            steps: [
              `"Met with doubt ... but ... eventually" sets up a reversal: the doubt was
                overcome.`,
              `Predict "proved it right". <em>Vindicated</em> means exactly that.`,
            ],
            answer: 'B',
          },
        ],
        traps: [
          `Choosing the most impressive-sounding word, or a word about the topic that
            does not fit the logic.`,
          `A word that is almost right. "Precise" in the question means a close synonym
            is still wrong.`,
        ],
        tips: [
          `Cover the choices and fill the blank yourself. Even a clumsy phrase like
            "proved right" makes the answer obvious.`,
          `Put your choice back into the sentence and read the whole thing aloud in
            your head.`,
        ],
      },
      {
        skill: 'Text Structure and Purpose',
        gist: 'What the whole text is doing, or what one sentence does within it.',
        idea: [
          `Every sentence has a job: it makes a claim, gives evidence, offers an example,
            brings up a counterpoint, qualifies an idea or concludes. Purpose questions
            ask for the job, not the content.`,
          `Answer choices begin with a verb: <em>to challenge</em>, <em>to
            illustrate</em>, <em>to describe</em>, <em>to argue</em>. Get the verb right
            first. Then check that every other word in the choice is also true.`,
        ],
        examples: [
          {
            q: `<blockquote>For years, many researchers assumed that animals living alone
              could not learn by watching others. <u>In one experiment, however, young
              animals of a solitary species that watched a trained adult open a container
              learned the task faster than those that had not.</u> Findings like this
              suggest that learning from others may not require a social life.</blockquote>
              Which choice best describes the function of the underlined sentence?
              ${choices(
                choice('A', 'It presents evidence that challenges the assumption in the first sentence.', '"However" plus an experiment that cuts against "could not learn" makes this a challenge.', true),
                choice('B', 'It explains why solitary animals avoid one another.', 'Not discussed at all.'),
                choice('C', 'It summarises the history of research on animal learning.', 'It describes one experiment, not a history.'),
                choice('D', 'It states the conclusion the text argues for.', 'That is the last sentence\'s job.'),
              )}`,
            steps: [
              `Label each sentence's job: sentence 1 is an old assumption, sentence 2 is
                evidence ("however"), and sentence 3 is the new conclusion.`,
              `The underlined sentence is the evidence that pushes against the
                assumption.`,
            ],
            answer: 'A',
          },
        ],
        traps: [
          `Choices that describe the content accurately but get the function wrong.`,
          `Overstatement. "Disproves" is not the same as "challenges".`,
        ],
        tips: [
          `Give each sentence a two- or three-word job label as you read. Most purpose
            questions are then answered by your labels.`,
        ],
      },
      {
        skill: 'Cross-Text Connections',
        gist: 'How the author of one text would respond to the other.',
        idea: [
          `You get two short texts on one topic. The question is usually how the second
            author would respond to a specific claim in the first.`,
          `Pin down the exact claim in Text 1. Then find where Text 2 addresses that same
            point. The relationship is usually one of three: <strong>agree</strong>,
            <strong>disagree</strong>, or <strong>agree in part</strong> (accept the
            observation, reject the conclusion). The third is the most common right
            answer.`,
        ],
        examples: [
          {
            q: `<blockquote><strong>Text 1:</strong> A critic argues that a novelist's later books
              are weaker than her early ones because they abandon the vivid, detailed
              settings that made her early work memorable.<br><br>
              <strong>Text 2:</strong> Another critic notes that the later books do give
              setting far less attention, but argues this is deliberate: stripping away
              the scenery keeps the reader inside the characters' thoughts, which is where
              these books do their best work.</blockquote>
              How would the critic in Text 2 most likely respond to the claim in Text 1?
              ${choices(
                choice('A', 'By agreeing that the later books give setting less attention, but denying that this makes them weaker', 'Accepts the observation and rejects the judgement. That is exactly Text 2.', true),
                choice('B', 'By arguing that the later books contain more detailed settings than the early ones', 'Text 2 concedes the opposite.'),
                choice('C', 'By agreeing that the later books are the novelist\'s weakest', 'Text 2 praises them.'),
                choice('D', 'By claiming that setting is unimportant in all fiction', 'Far too broad. Text 2 speaks only about these books.'),
              )}`,
            steps: [
              `Text 1's claim has two parts: less setting (an observation), therefore
                weaker (a judgement).`,
              `Text 2 accepts the observation ("do give setting far less attention") and
                rejects the judgement ("deliberate ... their best work").`,
            ],
            answer: 'A',
          },
        ],
        traps: [
          `Choices that are true of Text 2 but do not respond to Text 1's claim.`,
          `Sweeping versions of a text's narrow point, like "all fiction".`,
        ],
        tips: [
          `Split the Text 1 claim into its observation and its conclusion. Most right
            answers accept one and dispute the other.`,
        ],
      },
    ],
  });

  rw.domains.push({
    name: 'Information and Ideas',
    share: 0.26,
    blurb: `Understanding what a text says, choosing evidence that supports a claim,
      and drawing the conclusion the text supports.`,
    skills: [
      {
        skill: 'Central Ideas and Details',
        gist: 'The main point of a text, and what it states outright.',
        idea: [
          `The main idea covers the <em>whole</em> text and captures its point, not just
            its topic. Wrong answers are usually too narrow (one detail), too broad (a
            claim about the world), or distorted (the right words in the wrong
            relationship).`,
          `Detail questions have their answer stated in the text. You should be able to
            put your finger on the line.`,
        ],
        examples: [
          {
            q: `<blockquote>When the Harlow Public Library began lending tools such as drills,
              ladders and sewing machines, some board members worried the program would
              distract from the library's purpose. Two years later, the program has drawn
              hundreds of residents who had never held a library card, and many of them
              now borrow books as well. The librarian argues that the tool shelf has become
              one of the library's most effective ways to bring in new readers.</blockquote>
              Which choice best states the main idea of the text?
              ${choices(
                choice('A', 'A program some feared would distract from the library\'s mission has instead helped it attract readers.', 'Covers the worry, the result and the librarian\'s point.', true),
                choice('B', 'Every public library should lend tools.', 'A recommendation the text never makes. Too broad.'),
                choice('C', 'Some board members opposed lending tools.', 'True, but only the first sentence.'),
                choice('D', 'Sewing machines are the most borrowed item at the library.', 'Not stated anywhere.'),
              )}`,
            steps: [
              `Summarise the arc in one line: a worry, then a surprising success, then the
                librarian's conclusion.`,
              `Pick the choice that holds all three.`,
            ],
            answer: 'A',
          },
        ],
        traps: [
          `A choice that repeats an exact phrase from the text but twists its meaning.`,
        ],
        tips: [
          `The last sentence is often the author's point. Check that your answer agrees
            with it.`,
        ],
      },
      {
        skill: 'Command of Evidence',
        gist: 'Choose the quotation, finding or data point that supports or weakens a claim.',
        idea: [
          `There are two kinds. <strong>Textual:</strong> which finding or quotation would
            best support or undermine a claim. <strong>Quantitative:</strong> which choice
            uses a table or graph accurately <em>to complete the claim</em>.`,
          `Break the claim into its specific parts. The right evidence addresses every
            part. Wrong answers are often true, but about something slightly different.`,
          `With data, a choice must pass two tests: every number in it must be correct
            according to the graph, <em>and</em> it must support the specific claim.
            Several choices usually pass the first test and fail the second.`,
        ],
        examples: [
          {
            q: `A student claims that reading time did not change the same way for every
              grade at a school between 2020 and 2024. The table shows average daily
              reading, in hours:
              <table class="mini"><tr><th></th><th>2020</th><th>2024</th></tr>
              <tr><td>Grade 9</td><td>0.8</td><td>1.1</td></tr>
              <tr><td>Grade 12</td><td>0.9</td><td>0.7</td></tr></table>
              ${choices(
                choice('A', 'Grade 9 students read 1.1 hours a day in 2024.', 'True, but it shows only one grade. You cannot see "did not change the same way" from one grade.'),
                choice('B', 'Reading time rose for grade 9, from 0.8 to 1.1 hours, but fell for grade 12, from 0.9 to 0.7 hours.', 'Accurate, and it shows opposite directions, which is the claim.', true),
                choice('C', 'Both grades read less in 2024 than in 2020.', 'False for grade 9.'),
                choice('D', 'Grade 12 students read more than grade 9 students in 2020.', 'True, but it is about 2020 alone, not change.'),
              )}`,
            steps: [
              `The claim is about change, compared across grades.`,
              `So the evidence must show both grades' change and that they differ. Only B
                does.`,
            ],
            answer: 'B',
          },
          {
            q: `A researcher hypothesises that a songbird changes its song in response to
              background noise. Which finding would most directly support this?
              ${choices(
                choice('A', 'Birds recorded near busy roads sang at a higher pitch than birds of the same species in quiet forests.', 'Links a song change directly to noise.', true),
                choice('B', 'The species sings most often at dawn.', 'About timing, not noise.'),
                choice('C', 'Birds near roads were slightly larger on average.', 'About size, not song.'),
                choice('D', 'The species\' song contains up to twelve distinct notes.', 'Describes the song but gives no link to noise.'),
              )}`,
            steps: [
              `The hypothesis has two parts: song changes, and noise causes it.`,
              `Only A varies the noise and shows the song changing with it.`,
            ],
            answer: 'A',
          },
        ],
        traps: [
          `True but irrelevant: an accurate data point that does not touch the claim.`,
          `Choices that support a claim related to the real one, but broader or narrower.`,
        ],
        tips: [
          `For graph questions, read the claim first, then check each number in each
            choice. Do not study the graph until you know what you are looking for.`,
        ],
      },
      {
        skill: 'Inferences',
        gist: 'Complete a text with the conclusion that follows logically.',
        idea: [
          `The passage builds an argument and stops just before the end. You supply the
            conclusion that <em>must</em> follow from what is given, using no outside
            knowledge.`,
          `The right answer is usually modest. It says what the evidence allows and no
            more. Anything that would need extra information is wrong, however
            plausible.`,
        ],
        examples: [
          {
            q: `<blockquote>A certain plant grows in the wild only where a particular soil fungus
              is present. In a greenhouse trial, seeds planted in sterilised soil
              sprouted but died within weeks, while seeds planted in untreated soil from
              the same site thrived. These results suggest that ______</blockquote>
              ${choices(
                choice('A', 'the plant depends on something in untreated soil, likely the fungus, to survive after sprouting.', 'Follows from both halves of the trial, and hedges appropriately.', true),
                choice('B', 'sterilised soil stops the seeds from sprouting.', 'Contradicted: they did sprout.'),
                choice('C', 'the plant grows faster in greenhouses than in the wild.', 'No comparison with the wild was made.'),
                choice('D', 'the fungus harms other plants that grow near it.', 'Other plants are never mentioned.'),
              )}`,
            steps: [
              `What differed between the soils? Sterilising removed living things, the
                fungus among them.`,
              `What happened? Sprouting was fine, but survival failed without them.`,
              `The only safe conclusion connects those two facts.`,
            ],
            answer: 'A',
          },
        ],
        traps: [
          `Choices that are true in real life but not established by the passage.`,
          `Choices that contradict a detail, like "did not sprout" here.`,
        ],
        tips: [
          `Treat it like a maths proof. If a choice needs a fact the text did not give,
            it is out.`,
        ],
      },
    ],
  });

  rw.domains.push({
    name: 'Standard English Conventions',
    share: 0.26,
    blurb: `Punctuation and grammar. The most rule-bound part of the test: learn about
      a dozen rules and these become the fastest points available.`,
    skills: [
      {
        skill: 'Boundaries',
        gist: 'Commas, semicolons, colons, dashes and periods between clauses and phrases.',
        idea: [
          `Everything here depends on one idea: the <strong>independent clause</strong>, a
            group of words that could stand alone as a sentence.`,
          `<ul>
            <li><strong>Two independent clauses</strong> can be joined with a period, with a
              semicolon, or with a comma plus <em>and / but / or / so / yet / for /
              nor</em>. A comma alone is a <em>comma splice</em>, and it is always
              wrong.</li>
            <li><strong>A colon</strong> must follow a complete clause, and introduces an
              explanation or a list. "The recipe needs three things: flour, water and salt"
              is right. "The recipe needs: flour ..." is wrong.</li>
            <li><strong>Words like however and therefore</strong> are not conjunctions.
              Between two clauses they need a semicolon or period before them:
              "…failed; however, the team…".</li>
            <li><strong>An extra, removable phrase</strong> is fenced off by matching
              punctuation on both sides: two commas or two dashes, never one of each.</li>
            <li><strong>No punctuation</strong> between a subject and its verb, or between
              a verb and its object.</li>
          </ul>`,
        ],
        examples: [
          {
            q: `<blockquote>The experiment failed twice ______ the team refused to abandon it.</blockquote>
              ${choices(
                choice('A', 'twice, the', 'Comma splice: two clauses joined by a comma alone.'),
                choice('B', 'twice; the', 'A semicolon joins two independent clauses.', true),
                choice('C', 'twice the', 'Run-on: no punctuation at all.'),
                choice('D', 'twice: and the', 'Nothing should come between a colon and the clause it introduces, least of all "and".'),
              )}`,
            steps: [
              `"The experiment failed twice" can stand alone, and so can "the team refused
                to abandon it". That makes two independent clauses.`,
              `So you need a period, a semicolon, or comma + and/but. Only B is on that
                list.`,
            ],
            answer: 'B',
          },
          {
            q: `<blockquote>The ship's captain, a veteran of thirty voyages ______ ordered the
              crew below deck.</blockquote>
              ${choices(
                choice('A', 'voyages', 'Leaves the extra phrase open on one side.'),
                choice('B', 'voyages,', 'Closes the fence the first comma opened.', true),
                choice('C', 'voyages;', 'A semicolon is never used to close a phrase opened with a comma.'),
                choice('D', 'voyages —', 'Mismatched: opened with a comma, closed with a dash.'),
              )}`,
            steps: [
              `"a veteran of thirty voyages" is extra information. Lift it out and the
                sentence still works: "The ship's captain ordered…".`,
              `It opened with a comma, so it must close with one.`,
            ],
            answer: 'B',
          },
        ],
        traps: [
          `Semicolons and periods are interchangeable between two clauses. If two choices
            differ only in that, both are wrong.`,
          `Adding a comma before "that", or between a subject and its verb, because it
            feels like a pause.`,
        ],
        tips: [
          `The period test: a semicolon is right exactly where a period would also be
            right.`,
          `The lift-out test: extra material between commas or dashes should be
            removable without breaking the sentence.`,
        ],
      },
      {
        skill: 'Form, Structure, and Sense',
        gist: 'Agreement, verb forms and tense, pronouns, modifiers, plurals and possessives.',
        idea: [
          `<ul>
            <li><strong>Subject–verb agreement:</strong> find the real subject, skipping
              phrases like "of ancient coins". "The collection of coins <em>is</em>".</li>
            <li><strong>Pronouns</strong> match what they refer to. A company or a team is
              singular, so it takes <em>its</em>, not <em>their</em>.</li>
            <li><strong>Tense</strong> follows the time the sentence establishes. "Last
              spring … planted … and watered" stays in the past.</li>
            <li><strong>Every sentence needs a main verb.</strong> "-ing" and "to" forms
              cannot be the main verb.</li>
            <li><strong>Modifiers:</strong> an opening phrase describes whatever comes right
              after the comma. "Having studied the data, <em>the analysts</em> …", not
              "…, <em>a conclusion</em> was reached".</li>
            <li><strong>Possessives:</strong> <em>its</em> is possessive and
              <em>it's</em> is "it is". <em>researcher's</em> is one researcher and
              <em>researchers'</em> is several.</li>
          </ul>`,
        ],
        examples: [
          {
            q: `<blockquote>The novel, which was published in 1998 and later adapted for film,
              ______ a devoted following.</blockquote>
              ${choices(
                choice('A', 'having gained', 'Not a main verb.'),
                choice('B', 'to gain', 'Not a main verb.'),
                choice('C', 'gaining', 'Not a main verb.'),
                choice('D', 'gained', 'The sentence needs a main verb for "The novel".', true),
              )}`,
            steps: [
              `Lift out the extra clause: "The novel ______ a devoted following."`,
              `The subject has no verb yet, and only D can serve as one.`,
            ],
            answer: 'D',
          },
          {
            q: `<blockquote>The company announced that ______ quarterly profits had doubled.</blockquote>
              ${choices(
                choice('A', 'its', '"The company" is singular.', true),
                choice('B', 'their', 'Plural. The company is one thing.'),
                choice('C', 'it\'s', 'That means "it is".'),
                choice('D', 'there', 'A place, not a possessive.'),
              )}`,
            steps: [`The pronoun refers to "the company", which is singular and possessive,
              so <em>its</em>.`],
            answer: 'A',
          },
        ],
        traps: [
          `Agreeing the verb with the nearest noun ("coins") instead of the subject
            ("collection").`,
        ],
        tips: [
          `Strip the sentence to its skeleton, just subject and verb, before choosing.
            Most of these questions answer themselves at that point.`,
        ],
      },
    ],
  });

  rw.domains.push({
    name: 'Expression of Ideas',
    share: 0.20,
    blurb: `Editing for purpose: choosing the transition that fits the logic, and using
      someone's notes to meet a stated goal.`,
    skills: [
      {
        skill: 'Transitions',
        gist: 'Choose the connecting word that matches the logic between sentences.',
        idea: [
          `Name the relationship between the two sentences <em>before</em> you look at
            the choices:`,
          `<ul>
            <li><strong>Contrast:</strong> however, nevertheless, by contrast, still</li>
            <li><strong>Cause and effect:</strong> therefore, as a result, consequently, thus</li>
            <li><strong>Addition:</strong> moreover, furthermore, in addition</li>
            <li><strong>Example:</strong> for example, for instance</li>
            <li><strong>Restatement:</strong> in other words, that is</li>
            <li><strong>Concession:</strong> granted, admittedly</li>
            <li><strong>Similarity:</strong> similarly, likewise</li>
            <li><strong>Sequence:</strong> subsequently, finally, later</li>
          </ul>`,
          `Only one answer can be right, so two choices from the same group, like
            "therefore" and "thus", are both wrong.`,
        ],
        examples: [
          {
            q: `<blockquote>Most early cars were built by hand, one at a time. ______, they were
              expensive, and few families could afford one.</blockquote>
              ${choices(
                choice('A', 'As a result', 'Hand-building causes the high price.', true),
                choice('B', 'However', 'No contrast between the sentences.'),
                choice('C', 'For example', 'The second sentence is not an example of the first.'),
                choice('D', 'Similarly', 'Not a parallel situation.'),
              )}`,
            steps: [`Being built by hand is why they were expensive, so this is cause and
              effect.`],
            answer: 'A',
          },
          {
            q: `<blockquote>Some deep-sea fish produce their own light. ______, the anglerfish
              dangles a glowing lure in front of its mouth to attract prey.</blockquote>
              ${choices(
                choice('A', 'However', 'The anglerfish agrees with the first sentence rather than contrasting with it.'),
                choice('B', 'For instance', 'The anglerfish is one case of a fish producing light.', true),
                choice('C', 'Therefore', 'The first fact does not cause the second.'),
                choice('D', 'In contrast', 'No contrast here.'),
              )}`,
            steps: [`General claim, then one specific case, so it is an example.`],
            answer: 'B',
          },
        ],
        traps: [
          `Choosing a transition because it sounds formal. Only the logic decides.`,
        ],
        tips: [
          `Cover the choices and say the two sentences with "and so", "but", or "for
            example" between them. Whichever sounds right names the group.`,
        ],
      },
      {
        skill: 'Rhetorical Synthesis',
        gist: 'Use a student\'s notes to write a sentence that meets a stated goal.',
        idea: [
          `You get bullet-point notes and a goal, for example "emphasise a difference",
            "introduce the study to an unfamiliar audience", or "present the result".
            Several choices will be accurate. Only one does <strong>what the goal
            asks</strong>.`,
          `So read the goal first and underline its key words. Then judge each choice
            against the goal alone. You barely need the notes, because the wrong answers
            are usually accurate but aimed at a different goal.`,
          `"Unfamiliar audience" means the sentence must explain who or what something
            is. "Similarity" means it must name both things and what they share.`,
        ],
        examples: [
          {
            q: `A student's notes:
              <ul>
                <li>The Brooklyn Bridge opened in 1883. Its main span is about 486 m.</li>
                <li>The Golden Gate Bridge opened in 1937. Its main span is about 1,280 m.</li>
                <li>Both are suspension bridges.</li>
              </ul>
              The student wants to emphasise a difference in the bridges' spans.
              ${choices(
                choice('A', 'Both the Brooklyn Bridge and the Golden Gate Bridge are suspension bridges.', 'A similarity, not a difference.'),
                choice('B', 'At about 1,280 meters, the Golden Gate Bridge\'s main span is more than twice as long as the Brooklyn Bridge\'s span of about 486 meters.', 'Compares the spans directly.', true),
                choice('C', 'The Brooklyn Bridge opened in 1883, and the Golden Gate Bridge opened in 1937.', 'A difference, but in dates, not spans.'),
                choice('D', 'The Golden Gate Bridge has a main span of about 1,280 meters.', 'Only one bridge, so no comparison.'),
              )}`,
            steps: [
              `The goal's key words are "difference" and "spans".`,
              `A and C miss "spans", and D misses "difference". Only B does both.`,
            ],
            answer: 'B',
          },
        ],
        traps: [
          `Picking the most informative choice. More facts is not the goal.`,
        ],
        tips: [
          `Read the question's goal first, then the choices, and only then glance at the
            notes if two choices are still standing.`,
        ],
      },
    ],
  });

  return { sections: [math, rw] };
})();
