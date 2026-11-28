/**
 * index.mjs — 拼多多上架组件总入口
 *
 * 7 个独立组件，各自一个文件夹，互不影响：
 *   01-image-upload  图片/视频上传
 *   02-form-input    输入框（含 SKU 表格、inputNumber、自定义规格）
 *   03-button        按钮（XPath 点击）
 *   04-select        下拉选择（单选/多选/只读）
 *   05-radio         单选框
 *   06-sku-thumb     SKU 预览图
 *   07-attributes    商品属性批量填写（依赖 04）
 *
 * 用法
 *   import { imageUpload, formInput, button, select, radio, skuThumb, attributes } from './modules/index.mjs'
 *
 *   await imageUpload.uploadImages(page, { files: ['E:/a.png'], target: 'carousel-any' })
 *   await formInput.fillInput(page, { formItemId: 'goods_name', value: 'xxx' })
 *   await button.clickButton(page, { id: 'bottomSubmitBtnId', waitNavigation: true })
 *
 * 或按需单独引入（推荐，避免加载全部）
 *   import { uploadImages } from './modules/01-image-upload/index.mjs'
 *   import { fillInput } from './modules/02-form-input/index.mjs'
 */

export * as imageUpload from './01-image-upload/index.mjs'
export * as formInput from './02-form-input/index.mjs'
export * as button from './03-button/index.mjs'
export * as select from './04-select/index.mjs'
export * as radio from './05-radio/index.mjs'
export * as skuThumb from './06-sku-thumb/index.mjs'
export * as attributes from './07-attributes/index.mjs'

/** 组件清单（供程序读取） */
export const COMPONENTS = [
  { id: '01', key: 'imageUpload', name: '图片/视频上传', path: './01-image-upload/index.mjs', exports: ['uploadImages', 'probeImageRegion', 'uploadAll', 'UPLOAD_TARGETS'] },
  { id: '02', key: 'formInput', name: '输入框', path: './02-form-input/index.mjs', exports: ['fillInput', 'readInput', 'countLimit', 'fillFields', 'listInputs', 'fillSkuTable', 'fillCustomSpecValues'] },
  { id: '03', key: 'button', name: '按钮', path: './03-button/index.mjs', exports: ['clickButton', 'findButton', 'waitButtonReady', 'listButtons', 'buildXPath'] },
  { id: '04', key: 'select', name: '下拉选择', path: './04-select/index.mjs', exports: ['selectOptions', 'readSelected', 'probeSelect', 'openSelect', 'listOptions', 'closeAllSelects'] },
  { id: '05', key: 'radio', name: '单选框', path: './05-radio/index.mjs', exports: ['selectRadio', 'readRadio', 'listRadios'] },
  { id: '06', key: 'skuThumb', name: 'SKU 预览图', path: './06-sku-thumb/index.mjs', exports: ['setSkuThumbs', 'probeSkuThumbs', 'openThumbPicker', 'waitThumbPopup', 'pickThumbInPopup'] },
  { id: '07', key: 'attributes', name: '商品属性', path: './07-attributes/index.mjs', exports: ['fillAttributesByName', 'fillAttributes', 'listAttributes', 'checkRequiredAttributes'] },
]
