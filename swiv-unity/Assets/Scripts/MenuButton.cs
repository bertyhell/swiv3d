using UnityEngine;
using UnityEngine.UI;

public class MenuButton : MonoBehaviour
{
    [SerializeField] protected Text ShadowElem;
    [SerializeField] protected Text TextElem;
    [SerializeField] protected Image TopBorderElem;
    [SerializeField] protected Image RightBorderElem;
    [SerializeField] protected Image BottomBorderElem;
    [SerializeField] protected Image LeftBorderElem;

    [SerializeField] protected int Width = 1800;
    [SerializeField] protected int Height = 100;
    [SerializeField] protected string Text = "";
    [SerializeField] protected int BorderWidth = 6;
    [SerializeField] protected bool Disabled = false;
    [SerializeField] protected bool Selected = false;
    [SerializeField] protected bool Pressed = false;
    [SerializeField] protected bool BorderTopEnabled = false;
    [SerializeField] protected bool BorderRightEnabled = false;
    [SerializeField] protected bool BorderBottomEnabled = false;
    [SerializeField] protected bool BorderLeftEnabled = false;

    private Button button;
    private RectTransform rectTransform;
    private MenuController controller;

    private void Start() {
        TextElem.text = Text;
        ShadowElem.text = Text;
        rectTransform = GetComponent<RectTransform>();
        rectTransform.sizeDelta = new Vector2(Width, Height);
        button = GetComponent<Button>();

        TopBorderElem.enabled = BorderTopEnabled;
        RightBorderElem.enabled = BorderRightEnabled;
        BottomBorderElem.enabled = BorderBottomEnabled;
        LeftBorderElem.enabled = BorderLeftEnabled;

        button.onClick.AddListener(OnClick);
    }

    void Update() {
        if (Selected) {
            TopBorderElem.enabled = true;
            RightBorderElem.enabled = true;
            BottomBorderElem.enabled = true;
            LeftBorderElem.enabled = true;
        } else {
            TopBorderElem.enabled = false;
            RightBorderElem.enabled = false;
            BottomBorderElem.enabled = false;
            LeftBorderElem.enabled = false;
        }
    }

    void OnClick() {
        this.Selected = true;
    }
}
