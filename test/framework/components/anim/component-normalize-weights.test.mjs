import { expect } from 'chai';

import { INTERPOLATION_LINEAR } from '../../../../src/framework/anim/constants.js';
import { ANIM_LAYER_ADDITIVE, ANIM_LAYER_OVERWRITE } from '../../../../src/framework/anim/controller/constants.js';
import { AnimCurve } from '../../../../src/framework/anim/evaluator/anim-curve.js';
import { AnimData } from '../../../../src/framework/anim/evaluator/anim-data.js';
import { AnimTrack } from '../../../../src/framework/anim/evaluator/anim-track.js';
import { Entity } from '../../../../src/framework/entity.js';
import { createApp } from '../../../app.mjs';
import { jsdomSetup, jsdomTeardown } from '../../../jsdom.mjs';

describe('AnimComponent layer weight normalization', function () {

    let app;

    beforeEach(function () {
        jsdomSetup();
        app = createApp();
    });

    afterEach(function () {
        app.destroy();
        app = null;
        jsdomTeardown();
    });

    // a 1 second track holding the entity's localPosition x at a constant value
    const positionTrack = (name, x, entityPath = ['box']) => {
        const curve = new AnimCurve([{
            entityPath,
            component: 'graph',
            propertyPath: ['localPosition']
        }], 0, 0, INTERPOLATION_LINEAR);
        return new AnimTrack(name, 1, [new AnimData(1, [0, 1])], [new AnimData(3, [x, 0, 0, x, 0, 0])], [curve]);
    };

    // a 1 second track holding the entity's localRotation at a 90 degree yaw
    const rotationTrack = (name) => {
        const s = Math.SQRT1_2;
        const curve = new AnimCurve([{
            entityPath: ['box'],
            component: 'graph',
            propertyPath: ['localRotation']
        }], 0, 0, INTERPOLATION_LINEAR);
        return new AnimTrack(name, 1, [new AnimData(1, [0, 1])], [new AnimData(4, [0, s, 0, s, 0, s, 0, s])], [curve]);
    };

    // an entity with a base layer playing `baseTrack` and a second layer of the
    // given blend type and weight playing `upperTrack`
    const setup = (normalizeWeights, blendType, upperWeight, baseTrack, upperTrack, upperMask = null) => {
        const box = new Entity('box', app);
        app.root.addChild(box);
        box.addComponent('anim', { activate: true, normalizeWeights });
        box.anim.assignAnimation('Base', baseTrack);
        const upper = box.anim.addLayer('Upper', upperWeight, upperMask, blendType);
        upper.assignAnimation('Upper', upperTrack);
        return box;
    };

    const step = (frames = 5, dt = 0.1) => {
        for (let i = 0; i < frames; i++) {
            app.systems.anim.onAnimationUpdate(dt);
        }
    };

    const yaw = box => 2 * Math.atan2(box.localRotation.y, box.localRotation.w) * 180 / Math.PI;

    describe('with normalizeWeights enabled', function () {

        it('blends two layers holding the same position to that position', function () {
            const box = setup(true, ANIM_LAYER_ADDITIVE, 1, positionTrack('base', 10), positionTrack('upper', 10));
            step();
            expect(box.localPosition.x).to.be.closeTo(10, 1e-4);
        });

        it('blends two layers to the average of their positions when weights are equal', function () {
            const box = setup(true, ANIM_LAYER_ADDITIVE, 1, positionTrack('base', 10), positionTrack('upper', 20));
            step();
            expect(box.localPosition.x).to.be.closeTo(15, 1e-4);
        });

        it('blends two layers to the weighted average of their positions when weights differ', function () {
            const box = setup(true, ANIM_LAYER_ADDITIVE, 0.5, positionTrack('base', 10), positionTrack('upper', 20));
            step();
            // (10 * 1 + 20 * 0.5) / 1.5
            expect(box.localPosition.x).to.be.closeTo(13.3333, 1e-4);
        });

        it('blends two layers holding the same rotation to that rotation', function () {
            const box = setup(true, ANIM_LAYER_ADDITIVE, 1, rotationTrack('base'), rotationTrack('upper'));
            step();
            expect(yaw(box)).to.be.closeTo(90, 1e-3);
        });

        it('combines layers each frame with the current weights while blending to a weight', function () {
            const box = setup(true, ANIM_LAYER_ADDITIVE, 0, positionTrack('base', 10), positionTrack('upper', 20));
            step(1);
            box.anim.findLayer('Upper').blendToWeight(1, 0.5);
            for (let frame = 1; frame <= 6; frame++) {
                app.systems.anim.onAnimationUpdate(0.1);
                // the upper layer's weight at the start of this frame, rounded to
                // the float precision the layer weights are stored at
                const weight = new Float32Array([Math.min(1, (frame - 1) * 0.1 / 0.5)])[0];
                const expected = (10 + 20 * weight) / (1 + weight);
                expect(box.localPosition.x).to.be.closeTo(expected, 1e-4);
            }
        });

        it('leaves bones outside the upper layer mask fully driven by the base layer', function () {
            const box = new Entity('box', app);
            const spine = new Entity('spine', app);
            box.addChild(spine);
            app.root.addChild(box);

            // base layer animates both the box and the spine
            const baseCurves = [
                new AnimCurve([{ entityPath: ['box'], component: 'graph', propertyPath: ['localPosition'] }], 0, 0, INTERPOLATION_LINEAR),
                new AnimCurve([{ entityPath: ['box', 'spine'], component: 'graph', propertyPath: ['localPosition'] }], 1, 1, INTERPOLATION_LINEAR)
            ];
            const baseTrack = new AnimTrack('base', 1,
                [new AnimData(1, [0, 1]), new AnimData(1, [0, 1])],
                [new AnimData(3, [10, 0, 0, 10, 0, 0]), new AnimData(3, [1, 0, 0, 1, 0, 0])],
                baseCurves);

            // upper layer animates both too, but its mask only covers the spine
            const upperCurves = [
                new AnimCurve([{ entityPath: ['box'], component: 'graph', propertyPath: ['localPosition'] }], 0, 0, INTERPOLATION_LINEAR),
                new AnimCurve([{ entityPath: ['box', 'spine'], component: 'graph', propertyPath: ['localPosition'] }], 1, 1, INTERPOLATION_LINEAR)
            ];
            const upperTrack = new AnimTrack('upper', 1,
                [new AnimData(1, [0, 1]), new AnimData(1, [0, 1])],
                [new AnimData(3, [20, 0, 0, 20, 0, 0]), new AnimData(3, [2, 0, 0, 2, 0, 0])],
                upperCurves);

            box.addComponent('anim', { activate: true, normalizeWeights: true });
            box.anim.assignAnimation('Base', baseTrack);
            const upper = box.anim.addLayer('Upper', 1, { 'box/spine': { children: true } }, ANIM_LAYER_ADDITIVE);
            upper.assignAnimation('Upper', upperTrack);

            step();

            // the box is not in the upper layer's mask, so the base layer drives it fully
            expect(box.localPosition.x).to.be.closeTo(10, 1e-4);
            // the spine is in the mask, so it blends both layers with normalized weights
            expect(spine.localPosition.x).to.be.closeTo(1.5, 1e-4);
        });

    });

    describe('with normalizeWeights disabled', function () {

        it('overwrite layers keep their existing results', function () {
            let box = setup(false, ANIM_LAYER_OVERWRITE, 1, positionTrack('base', 10), positionTrack('upper', 10));
            step();
            expect(box.localPosition.x).to.be.closeTo(10, 1e-4);

            box = setup(false, ANIM_LAYER_OVERWRITE, 1, positionTrack('base', 10), positionTrack('upper', 20));
            step();
            expect(box.localPosition.x).to.be.closeTo(20, 1e-4);

            box = setup(false, ANIM_LAYER_OVERWRITE, 0.5, positionTrack('base', 10), positionTrack('upper', 20));
            step();
            expect(box.localPosition.x).to.be.closeTo(15, 1e-4);

            box = setup(false, ANIM_LAYER_OVERWRITE, 1, rotationTrack('base'), rotationTrack('upper'));
            step();
            expect(yaw(box)).to.be.closeTo(90, 1e-3);
        });

        it('additive layers keep their existing results', function () {
            let box = setup(false, ANIM_LAYER_ADDITIVE, 1, positionTrack('base', 10), positionTrack('upper', 10));
            step();
            expect(box.localPosition.x).to.be.closeTo(20, 1e-4);

            box = setup(false, ANIM_LAYER_ADDITIVE, 1, positionTrack('base', 10), positionTrack('upper', 20));
            step();
            expect(box.localPosition.x).to.be.closeTo(30, 1e-4);

            box = setup(false, ANIM_LAYER_ADDITIVE, 0.5, positionTrack('base', 10), positionTrack('upper', 20));
            step();
            expect(box.localPosition.x).to.be.closeTo(20, 1e-4);
        });

    });

});
