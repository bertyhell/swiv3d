// Smooth Follow from Standard Assets
// Converted to C# because I fucking hate UnityScript and it's inexistant C# interoperability
// If you have C# code and you want to edit SmoothFollow's vars ingame, use this instead.
using UnityEngine;

public class MenuInfo {
    public readonly string buttonTitle;
    public readonly string menuTitle;
    public readonly int order;
    public readonly bool disabled;
    public readonly MenuInfo[] subMenuItems;

    public MenuInfo(string buttonTitle, string menuTitle, int order, bool disabled, MenuInfo[] subMenuItems) {
        this.buttonTitle = buttonTitle;
        this.menuTitle = menuTitle;
        this.order = order;
        this.disabled = disabled;
        this.subMenuItems = subMenuItems;
    }
}